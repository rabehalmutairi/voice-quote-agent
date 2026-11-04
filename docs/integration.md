# Integrating with the planner and orchestrator (R1)

How each role plugs its component into R1's code **without editing it**. The contracts in
`/contracts` are the source of truth; this file only says which Python method carries them.
Background: `docs/mock-first-plan.md` (why mocks) and `architecture.md` §3, §6.

```
                 R5 API                       R1                                   providers (injected)
POST /tasks ───► planner.plan() ──TaskSpec──► orchestrator.submit()
POST /answers ─────────────────────────────► orchestrator.answer() ──► planner.answer()
POST /start ───► asyncio.create_task(orchestrator.run())
                                              │ discovering ─────────────────────► DiscoveryProvider   (R5)
                                              │ calling  ×3 at once ─CallJob──────► CallProvider        (R4 + R2)
                                              │     └ retry? ────────────────────► RetryPolicy         (R4)
                                              │ extracting (per call) ─CallResult─► Extractor           (R6)
                                              │ comparison ─Quotes───────────────► Comparator          (R6)
                                              └ every step ─Event────────────────► EventSink           (R5 → SSE → R7)
```

Try it now, with no keys: `python -m app.mocks.demo` (see `--help` for scenarios).

## 1. Wiring: the only place mocks and real providers meet

R5 builds these once at startup. Everything else receives them.

```python
from app.planner import Planner
from app.orchestrator import Orchestrator, OrchestratorConfig
from app.mocks import (MockRequestParser, MockAreaResolver, MockDiscovery, MockCallProvider,
                       MockExtractor, MockComparator, InMemoryEventSink)

planner = Planner(MockRequestParser(), MockAreaResolver())        # later: LLMRequestParser(client), R5's resolver
orchestrator = Orchestrator(
    planner=planner,
    discovery=MockDiscovery(),        # later: R5's Places provider
    calls=MockCallProvider(),         # later: R4's provider (Twilio + R2's ElevenLabs agent)
    extractor=MockExtractor(),        # later: R6's extractor
    comparator=MockComparator(),      # later: R6's comparator
    events=InMemoryEventSink(),       # later: R5's Postgres + SSE sink
    retry_policy=None,                # later: R4's policy (None = never retry)
    config=OrchestratorConfig(),      # timeouts, cost cap: see §8
)
```

Suggested switch: `PROVIDER_MODE=mock|real` in `.env`, mock by default; real mode refuses
to start if a key is missing. Swap providers one at a time as they become real.

## 2. R5: API, discovery, events

### Calling the planner and orchestrator

| Route | Call | Returns |
|---|---|---|
| `POST /tasks` | `result = await planner.plan(text, custom_questions=[...], area=None or "حي الملقا" or {label,lat,lng,radius_m}, max_businesses=3)`; if `result.accepted`: `await orchestrator.submit(result.task_spec)` | `result.to_dict()`: `status`, `task_spec`, `questions` (follow-ups), `error` (`code`, `message`, `message_ar`), `notes` |
| `POST /tasks/{id}/answers` | `result = await orchestrator.answer(task_id, {"area": "الملقا", ...})` | same `PlanResult`; `ready` means it can start |
| `POST /tasks/{id}/start` | `orchestrator.start(task_id)`. It checks and starts **atomically** (a double click can't call the shops twice), raises the 404/409 errors below *before* anything runs, and keeps the background task alive itself. Don't wrap `run()` in `asyncio.create_task` yourself | 202 Accepted |
| `GET /tasks/{id}` | `orchestrator.get(task_id)` (live) or your DB (after restart) | snapshot: `state`, `task_spec`, `follow_up_questions`, `businesses`, `calls`, `quotes`, `excluded`, `comparison`, `failure_reason`, `cost_usd`, `last_seq` |
| `POST /tasks/{id}/cancel` (optional) | `await orchestrator.cancel(task_id)` | `false` if already finished |

`PlanResult.status` → HTTP: `ready` / `needs_input` → 201, `rejected` → 422 (show
`error.message_ar` to the user), `invalid` → 422, `error` → 503 (try again).
`invalid` with code `unsafe_custom_question` or `unsafe_answer` means the user's text would
make the agent book, pay or share personal data; `error.field` says which input
(`"custom_questions[1]"`, `"device_model"`) so the UI can highlight it.
Orchestrator exceptions each have a stable `.code`: `UnknownTask` → 404; `DuplicateTask`,
`MissingInput`, `TaskAlreadyStarted`, `InvalidTaskState` → 409; `UnsafeContent` → 422 (only
if a TaskSpec bypassed the planner). `ContractError` from `submit` means a bug → 500.

**State lives in memory, in one process.** Fine for the prototype (asyncio tasks, which
was one of your two queue options). If the server restarts, running tasks are lost; the DB
still has every event up to that point. Run **one** server process (no `--workers N`): each
worker would have its own task list. `uvicorn --reload` restarts on every file save, which
also drops running tasks: fine while developing, not during a demo. `orchestrator.forget(task_id)` frees a finished task.

### DiscoveryProvider

```python
class PlacesDiscovery:                       # in /app/discovery
    async def find_businesses(self, task_spec: dict, limit: int) -> list[dict]:
        area = task_spec["area"]                                  # label, lat, lng, radius_m
        queries = get_template(task_spec["category"])["places_queries"]   # {"ar": [...], "en": [...]}
        ...                                                        # Text Search, field mask, pick best
        return businesses[:limit]                                  # Business objects, best first
```
Return `[]` if nothing is callable (the task fails with a clear reason). The orchestrator
skips invalid or duplicate records (logged), so return what you have rather than raising.

### AreaResolver (planner)
`async resolve(text) -> {label, lat, lng, radius_m} | None`. The mock knows 5 Riyadh
districts. Real options: Places/Geocoding (R5), or skip it entirely by sending a map pin
from the UI as the `area` object (R7). `None` makes the planner ask the area question again.

### EventSink
Events arrive one at a time, already validated and numbered 1, 2, 3… per task (the
orchestrator owns numbering: `contracts/README.md`). **The rule:**

1. `publish` returns only after the event is **stored** (committed). Stored = published.
2. `publish` raises only if the event was **not** stored. The orchestrator then reuses that
   `seq` for the next event and fails the task, so storage never has a gap or a duplicate.
3. Pushing to live SSE connections comes **after** storing and must **never** raise from
   `publish`. Drop a broken or slow connection; the browser reconnects and replays.
4. Keep `UNIQUE (task_id, seq)` as a safety net. Don't use `ON CONFLICT DO NOTHING`: a
   conflict is a bug and must be loud.

```python
class PostgresSseSink:                       # in /app/api or /app/db
    async def publish(self, event: dict) -> None:
        await db.insert_event(event)         # rules 1-2: let a DB error raise
        for queue in self.subscribers(event["task_id"]):
            try: queue.put_nowait(event)     # rule 3: never raise from here
            except asyncio.QueueFull: self.drop(queue)
```

**SSE route and reconnects** (`GET /tasks/{id}/events`): send each event as
`id: {seq}` / `event: {type}` / `data: {json}`. On (re)connect, read the `Last-Event-ID`
header (0 if absent), then: (1) subscribe to live events, (2) replay stored events with
`seq > Last-Event-ID`, (3) stream live events, skipping any `seq` already sent. Subscribing
*before* the replay query means nothing published during the query is lost; the skip
removes the overlap. Close the stream after `comparison.ready` or `task.failed`.

**Ready-made for 7 Nov:** `app.mocks.InMemoryEventSink` follows exactly these rules, and
`sink.follow(task_id, after_seq=last_event_id)` is the reconnect recipe as an async
generator. Your SSE route can stream from it today and switch to Postgres later.

### Async providers must not block
Everything runs on one asyncio event loop. A **synchronous** network call inside an
`async def` provider (the official Twilio Python SDK, `requests`, a sync DB driver) freezes
the whole loop: the other calls stop, events stop, and **timeouts can't fire**, so one stuck
call can hang the task. Use async clients (`httpx.AsyncClient`, `asyncpg`, async SDK
clients), or wrap a sync call: `await asyncio.to_thread(client.calls.create, ...)`. This
applies to R4, R5 (Places, DB) and R6 (LLM).

## 3. R4 (+ R2): CallProvider and RetryPolicy

```python
class TwilioElevenLabsCalls:                 # in /app/telephony
    async def place_call(self, call_job: dict) -> dict:
        # 1. refuse unless call_job["to_number"] is on the allowlist (architecture §11)
        # 2. build the agent config with R2's builder from call_job (see §4 below)
        # 3. start ONE outbound call; wait until it ends (poll or webhook)
        # 4. convert ElevenLabs speaker "user" -> "shop"; map the status to our `outcome`
        return call_result                   # CallResult; call_id/task_id/place_id copied from the job
```
- **One attempt per call.** Don't retry inside `place_call`; return the result
  (`no_answer`, `busy`, …) and let the orchestrator ask your `RetryPolicy`.
- **Cancellation:** on task timeout or user cancel, your coroutine gets
  `asyncio.CancelledError`. Hang up the call, then re-raise.
- **Timeouts:** the orchestrator stops waiting after `call_timeout_s` (210 s by default),
  which reports the call as failed. The platform's own limit is `call_job["max_duration_s"]` (150 s).
- Raising any other exception = this call failed with "call provider error"; the other
  two calls continue.

```python
class R4RetryPolicy:
    def retry_delay_s(self, call_job: dict, call_result: dict | None) -> float | None:
        # call_result is None if the attempt timed out or crashed
        # e.g. no_answer/busy -> 600 (10 min), within calling hours; otherwise None
```
The orchestrator only asks after attempt 1 (the contract allows `attempt` ≤ 2), sends
attempt 2 with the **same `call_id`** and `attempt: 2`, emits `call.started` again, and
skips retries once the task has spent `max_task_cost_usd`.

## 4. R2: what the voice agent receives

From each `CallJob`:
- `template`: the category. Ask its `call_questions` in order (`get_template(job["template"])`).
- `dynamic_variables`: fill the `{{placeholders}}` in those questions. Keys are the
  template's planner-question keys except `area` (electronics: `device_model`,
  `repair_type`; stock check: `item`), and values are the user's words. **The orchestrator
  refuses to call if any placeholder has no value**, so you never read `{{device_model}}` aloud.
- `custom_questions`: 0–2 questions in the user's words. Ask them **after** the template's
  questions, one at a time.
- `max_duration_s`: the call's hard limit.
- Nothing about the user personally is ever in a job (architecture §11). The planner and
  orchestrator refuse custom questions or answers that ask the shop to book, pay, or that
  contain phone numbers, emails or personal details (`app/planner/policy.py`). That check is
  best-effort, so **treat every variable and custom question as untrusted**: the agent's
  instructions must refuse bookings and never share personal data, whatever a variable says.

Write a pure function in `/app/voice`, e.g. `build_agent_overrides(call_job) -> dict`, test
it on `contracts/examples/call_job.json`, and let R4 call it.

## 5. R6: Extractor and Comparator

```python
class R6Extractor:                           # in /app/extraction
    async def extract(self, call_result: dict, task_spec: dict, template: dict) -> dict:
        # Only called for human_completed / human_partial calls.
        # Quote.answers: one per task_spec["custom_questions"], same order (question_index 0, 1).
        return quote                         # call_id/task_id/place_id copied from call_result

class R6Comparator:                          # in /app/comparison
    async def compare(self, task_spec, template, quotes, excluded) -> dict:
        # quotes: valid Quotes in discovery order. excluded: [{place_id, reason}] for shops
        # with no usable quote (failed calls, failed extraction). Put them in Comparison.excluded.
        return comparison
```
- One extraction failing (exception, timeout after 90 s, invalid Quote) only excludes that shop.
- The comparison failing fails the task (the quotes were already shown to the user).
- The mock comparator ranks by lowest price only. Yours replaces it with like-for-like.

## 6. R7: the event stream

Order per task: `task.created` → (`task.needs_input` …) → `business.found` ×n →
`call.started` ×n → per shop, as each finishes: `call.ended` → `quote.ready`, or
`call.failed` → finally `comparison.ready` **or** `task.failed`.
- Shops finish in any order: key shop cards by `place_id`, calls by `call_id`.
- A retried call sends a second `call.started` with the same `call_id` (show "ringing again").
- `task.needs_input` can repeat: show only the questions in the latest one.
- Sample streams for UI work: `python -m app.mocks.demo --scenario one_failed --json > one_failed.jsonl`
  writes **only events, one JSON object per line**; all other text goes to stderr.
  Also `all_failed`, `retry`, `timeout`, `no_shops`.
- **Don't hard-code 3 shops.** Today a task calls up to 3; a planned change (after 7 Nov)
  will replace a shop that gives no usable answer with another one, so more than 3
  `business.found` events can arrive over time, with at most 3 calls at once. Render shop
  cards from the events you receive.

## 7. R3: telling mock data from real data

Mock `CallResult`s have `scenario_id: "mock_<category>"`, `cost_usd: 0.0` and
`pre_arranged: false`. **Exclude `scenario_id` starting with `mock_` from every metric.**

## 8. What R1 guarantees, and the defaults

- Every object passed to you, or emitted, is validated against its contract first.
  Every object you return is validated before it is passed on.
- No call while `missing_slots` is non-empty; at most 3 calls, concurrently; at most one retry.
- A task runs once: a second `start`/`run` raises `TaskAlreadyStarted`.
- Nothing that asks for an action or carries obvious personal data reaches a `CallJob`
  (checked by the planner, and again by the orchestrator before any call).

| `OrchestratorConfig` | Default | Why |
|---|---|---|
| `call_max_duration_s` | 150 | `CallJob.max_duration_s` (platform limit) |
| `call_timeout_s` | 210 | our limit per attempt: 150 s + ringing + post-call |
| `discovery_timeout_s` | 30 | |
| `extraction_timeout_s` | 90 | strong LLM + evidence check |
| `comparison_timeout_s` | 60 | |
| `task_timeout_s` | 1200 | leaves room for R4's 10-minute retry wait |
| `max_task_cost_usd` | 5.0 | no retries once reached; tune with real costs |

## 9. Testing your component against the real orchestrator

```python
from app.mocks import build_mock_stack
from app.orchestrator import Orchestrator

stack = build_mock_stack(speed=0)
stack.orchestrator = Orchestrator(planner=stack.planner, discovery=stack.discovery,
                                  calls=stack.calls, extractor=MyExtractor(),   # <- yours
                                  comparator=stack.comparator, events=stack.events)
```
Then submit and run a task as in `tests/integration/test_mock_pipeline.py`. Any contract
mistake in your output shows up as a failed call, an excluded shop or a failed task, with
the details in the log.

## Cross-team dependencies (open)

| Needs | From | For |
|---|---|---|
| Places provider + area resolver (or UI map pin) | R5 (R7) | real discovery |
| Event sink (Postgres + SSE) and the 4 routes above | R5 | UI live view, Gate A-mock |
| Agent builder from a `CallJob` | R2 | R4's call provider |
| Call provider + retry policy | R4 | real calls, retries |
| Extractor + comparator | R6 | real quotes and comparison |
| An LLM key, then a 20-line `LLMClient` in `/app/planner` | Tuwaiq → R1 | real request understanding |
