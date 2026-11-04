# Mock-first plan (KSU Weeks 11–12)

Status: **active from Tue 3 Nov 2026**. Owner: R1. Read with `architecture.md` §10.
Where this file and the old per-role table in §10 disagree, **this file wins** until the
API subscriptions arrive.

## 1. Why

Tuwaiq's API subscriptions are delayed and have no confirmed date: **ElevenLabs Agents,
Twilio, Google Places, and the paid LLM API**. We don't pause. We build the whole system
against **mock providers** now and swap in the real ones when the keys arrive.

This is **not a redesign**. Scope, roles, folders, contracts and the tech stack
(`architecture.md` §2–§8) stay exactly as they are.

## 2. How mock-first works

**The contracts are the interfaces.** Every external service sits behind one small Python
interface. Its inputs and outputs are contract objects: plain dicts that validate against
`/contracts`. Code that calls an interface never knows whether a mock or a real provider is
behind it.

| Interface | In → out | Mock today (`app/mocks/`, R1) | Real implementation (later) | Real owner |
|---|---|---|---|---|
| `RequestParser` | request text → category + slots | keyword lexicon, deterministic | `LLMRequestParser` + an LLM client | R1 |
| `AreaResolver` | "حي الملقا" → `TaskSpec.area` | fixed list of Riyadh districts | Places/geocoding, or a map pin from the UI | R5 / R7 |
| `DiscoveryProvider` | `TaskSpec` → `Business` ×3 | 3 fictional shops | Places Text Search | R5 |
| `CallProvider` | `CallJob` → `CallResult` | scripted transcripts, chosen per scenario | ElevenLabs Agents + Twilio | R2 + R4 |
| `RetryPolicy` | `CallResult` → retry or not | never retries | R4's rules (max 1 retry, calling hours) | R4 |
| `Extractor` | `CallResult` → `Quote` | fixture quotes | LLM extraction + evidence checker | R6 |
| `Comparator` | `Quote`s → `Comparison` | "cheapest price wins" | like-for-like comparison | R6 |
| `EventSink` | `Event` → stored + streamed | in-memory list | Postgres + SSE | R5 |

The exact Python signatures and how to plug in are in `docs/integration.md`. It arrives
with the R1 implementation PR.

**Rules:**
1. Mocks live only in `app/mocks/` (R1) and in tests. **No mock code in another role's
   folder.** Your real adapter goes in your own folder and implements the interface.
2. Every mock returns data that **passes the schemas**. If a mock needs a shape the contract
   doesn't have, that's a `contract-change` PR, not a quiet workaround.
3. **Mock mode makes no network calls and holds no real phone numbers.** Fixture numbers are
   `+9665000000xx`. The mock call provider refuses any number that isn't one of its fixtures.
4. Mocks and real providers are swapped **in one place**: the backend's startup wiring (R5).
   Nobody edits the planner or orchestrator to integrate.
5. **Mock results are never reported as results.** Mocks prove wiring, state, concurrency,
   contracts and UI flow. They prove nothing about Arabic speech recognition, reach rate,
   extraction accuracy, latency or cost. Every number in §9 still comes from real or
   role-play calls.

## 3. Deliverables per role

"Now" needs no API key. **Thu 5 Nov** is a progress checkpoint: show what runs so far, even
on a branch. **Fri 6 Nov** is the deadline for your **first working PR**: it can be
incomplete, but it runs and has at least one test. **Sat 7 Nov** is the integrated mock MVP.

### R1: planner, orchestrator, integration
- **Now:** template-driven planner (mock parser + LLM adapter ready for a key);
  orchestrator (state machine, 3 concurrent calls, timeouts, cancellation, ordered events);
  mocks for every provider in §2; runnable mock demo; `docs/integration.md`; CI runs every test.
- **Done 3 Nov:** all of the above merged; demo `request → TaskSpec → 3 mock calls → quotes → comparison → events`.
- **Fri 6 Nov:** integration fixes: atomic `start()`, outbound safety check, event-sink rule, clean `--json`.
- **Sat 7 Nov:** wired into R5's API with mocks; unblock each role's first real adapter.
- **Blocked:** the planner's real language understanding (LLM key).

### R2: voice agent
- **Now:** agent configuration as code in `/app/voice` and `/prompts`: prompt, first message,
  call flow, the user's own questions, the honest "are you a robot?" answer, voicemail/IVR
  rule, English switch. Write a function that turns a `CallJob` into the agent's
  configuration and dynamic variables, with unit tests on `contracts/examples/call_job.json`.
  Write the push-to-ElevenLabs script (it can't run yet).
- **Fri 6 Nov (first PR):** prompt + config builder merged with tests. **Sat 7 Nov:** call flow reviewed
  against R3's scenario cards on paper (read the script aloud as a role-play with R4).
- **Blocked:** pushing the agent, picking the voice, LLM A/B, any call (ElevenLabs).

### R3: speech recognition + evaluation
- **Now:** Arabic normalization + number parser ("ثلاثمية وخمسين" = 350) with tests; SADA
  download + phone-simulation script; ≥10 scenario cards with hidden ground truth; the
  labelling format; metrics script v0 that reads `CallResult` + `Quote` + labels and prints the
  §9 table, run on fixtures and hand-written transcripts.
- **Fri 6 Nov (first PR):** number parser + scenario cards. **Sat 7 Nov:** metrics script v0 on fixtures.
- **Blocked:** the speech benchmark (Scribe needs ElevenLabs, Deepgram needs a key); the fake
  shopkeeper (LLM); labelling real calls.

### R4: telephony
- **Now:** allowlist check (refuse any number not on it); mapping from Twilio/ElevenLabs call
  statuses to our `outcome` values, unit-tested on hand-written status payloads; a
  `RetryPolicy` (max 1 retry after 10 min, calling hours) that plugs into the orchestrator;
  `docs/telephony.md` test plan; **email Unifonic now** (no key needed).
- **Fri 6 Nov (first PR):** allowlist + outcome mapping. **Sat 7 Nov:** `RetryPolicy` used by the
  orchestrator in the mock pipeline.
- **Blocked:** Twilio account, caller-ID test, every real call, reach rate.

### R5: backend + discovery
- **Now:** FastAPI routes (`architecture.md` §8 R5) calling R1's planner and orchestrator with
  mocks; Postgres tables; an `EventSink` that stores events and serves them over SSE; Places
  request builder (field mask, `regionCode=SA`) and the "pick 3" logic, tested on a
  hand-written Places response JSON.
- **Fri 6 Nov (first PR):** `POST /tasks` + `POST /tasks/{id}/answers` working on the mock planner.
  **Sat 7 Nov:** `POST /tasks/{id}/start` runs a full mock task; `GET /tasks/{id}/events` streams it.
- **Blocked:** real Places searches for 3 Riyadh districts.

### R6: extraction + comparison
- **Now:** the **evidence checker** (pure code); **comparison** with `cannot_compare` /
  `side_by_side` (pure code); the extraction prompt + a parser for the LLM's JSON, tested with a
  fake LLM response. Neither the checker nor comparison needs a key.
- **Fri 6 Nov (first PR):** evidence checker with tests on the example quote. **Sat 7 Nov:** real
  `Comparator` replaces R1's mock in the mock pipeline.
- **Blocked:** real LLM extraction, the ElevenLabs baseline experiment, hallucination numbers.

### R7: frontend
- **Now:** the whole UI against fake events (`contracts/examples/events/`), then against R5's
  SSE endpoint running the mock pipeline: request box, follow-up questions, 3 shop cards,
  evidence view, can't-compare state.
- **Fri 6 Nov (first PR):** UI plays the example event sequence. **Sat 7 Nov:** UI driven live by R5's SSE
  on a mock task, no manual refresh.
- **Blocked:** nothing until the dashboard needs real metrics.

## 4. What stays blocked until API access

| Needs | Blocked work | Roles | Until then |
|---|---|---|---|
| ElevenLabs + Twilio | any real call; Gate A and Gate B (real); caller-ID test; role-play calls over the phone; reach rate; real-shop calls; ≥50 labelled calls | R2, R4, R3, R1 | mock calls; scenario cards; paper role-plays |
| ElevenLabs Scribe / Deepgram | speech benchmark (Gate B input) | R3 | prepare clips + scripts so the benchmark runs in one day |
| LLM API | planner language understanding; extraction; fake shopkeeper; live-call LLM A/B | R1, R6, R3, R2 | deterministic mock parser; fixture quotes; prompts and parsers tested on fake responses |
| Google Places | real discovery | R5 | mock shops; parser tested on a hand-written response |

**Evaluation risk (the biggest one).** §9 promises ≥50 labelled calls by the freeze. That
needs real calls starting by about **Sun 8 Nov**. If keys come later, we report a smaller
labelled set honestly, with its size. We never pad it with mock data.

## 5. From mock to real provider

When a key arrives, the owner of that provider does this, in order:
1. **Key goes in `.env`** (never in git). R1 checks the spend against the $500 budget first.
2. **Write the adapter in your own folder** implementing the interface from §2. Its output
   must pass the contract schema. Reuse `app/contracts.py` to validate.
3. **Test it without the network:** save one real response (no personal data) as a test
   fixture and test the adapter's parsing on it. CI never calls a paid API.
4. **Smoke test by hand** behind an explicit flag, only to **allowlisted numbers** (§11).
5. **Swap it in** at R5's startup wiring (for example `PROVIDER_MODE=mock|real`, mock by
   default; real mode refuses to start without its keys). Mocks stay for CI, demos and the
   recorded fallback.

**Activation policy.** A real provider is switched on only when **all** of these hold:
- its adapter and its parsing tests (on saved responses) are merged, and the full test suite is green;
- it sits behind an explicit flag (`PROVIDER_MODE`), mock by default;
- a **controlled live smoke test** passed and is written down with its date in `docs/`:
  3 calls to allowlisted numbers, 5 Places searches, or 10 extractions on role-play transcripts;
- rollback is one step: set the flag back to mock.

A saved response proves the parsing, not the connection or its reliability; only the smoke
test does. **Activation and validation** (flags, keys, smoke tests, fixes that make an existing
adapter work) are allowed after the feature freeze. **New behaviour** is a feature and is not.

Suggested order once keys exist: **LLM** (unblocks planner, extraction, fake shopkeeper) →
**ElevenLabs + Twilio** (calls, speech benchmark) → **Places** (mock shops are fine for
pre-arranged calls).

## 6. Milestones

| Date | Milestone | What "done" means |
|---|---|---|
| Thu 29 Oct | **Gate A (real)**: one controlled call stored against a `TaskSpec` | ⛔ **Blocked: no ElevenLabs/Twilio.** Not passed. Runs within 2 working days of the keys |
| Tue 3 Nov | **Gate B (real)**: voice-stack decision | ⛔ **Blocked: no calls, no speech benchmark.** We stay on ElevenLabs (§4) by default; a switch needs clear evidence from real tests, and nothing switches after Thu 12 Nov |
| **Thu 5 Nov** | **Progress checkpoint** | every role shows what runs so far (merged or on a branch) and names its blockers. R1's full mock demo runs |
| **Fri 6 Nov** | **First working PR from every member** | each role's "Fri 6 Nov (first PR)" item from §3 is open as a PR: it may be incomplete, but it runs and has a test |
| **Sat 7 Nov** | **Integrated mock MVP (Gate A-mock + Gate B-mock)** | Gate A-mock: request → `TaskSpec` (follow-up questions when info is missing) → mock call → `CallResult` stored by R5. Gate B-mock: through R5's API: 3 concurrent mock calls → extraction → comparison → every event in order over SSE → R7's UI, with no manual refresh. R6's real comparison and R4's retry policy plugged in. One failed call doesn't stop the other two |
| **Thu 12 Nov** | **Full integration + Gate C** | every team component that doesn't need a key is real; mocks remain only where a key is missing. If keys arrived: first real calls to allowlisted numbers. Gate C (car stretch) needs real labelled-call numbers, so **without keys Gate C is "no"** and cars go to future work |
| **Sat 14 Nov** | **Feature freeze** | bug fixes only after this. Real providers may still be **activated and validated** afterwards, under the activation policy in §5 (smoke test, flag, rollback) |
| **Wed 18 Nov** | **Internal submission-ready target** | final README, metrics, slides, demo + recorded fallback. ⚠️ If keys are still missing, we submit the full pipeline on mocks and **say clearly** that real-provider validation is pending. We claim no metric we didn't measure |
| **Thu 19 Nov** (provisional) | **Expected submission: end of KSU Week 13** | exact date to be confirmed by the AI track leader. Any days between 18 Nov and the deadline go to evaluation and rehearsal, not features |
| **Thu 10 Dec** | **Tuwaiq showcase** (separate from the KSU submission) | real-provider integration and real-call evaluation that missed the submission can be finished for the showcase, on its own list in the README |

**If the keys are late:**
- **By Sun 8 Nov:** the plan holds. ≥50 labelled calls is tight (about 10 a day).
- **By Thu 12 Nov:** real calls to a handful of pre-arranged numbers only. Smaller evaluation,
  reported with its size. Gate C is no.
- **Not before the freeze:** submit on mocks with the honest note above. Real calls move to
  the showcase.
