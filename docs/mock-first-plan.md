# Plan: deliverables, deadlines and mocks

The authoritative list of **what each role delivers and when**. Our ElevenLabs, Twilio,
Google Places and LLM subscriptions are delayed with no confirmed date, so we build against
mocks (`app/mocks/`) and switch to real providers when the keys arrive. Owner: R1.

## 1. Milestones

Weeks run Sunday–Thursday. Something exists only once it is merged to `main`.

| Date | Milestone | Done means |
|---|---|---|
| **Thu 5 Nov** | Progress checkpoint | Every role shows what runs so far (merged or on a branch) and names its blockers |
| **Fri 6 Nov** | **First working PR from every member** | Your "Fri 6" item below is open as a PR: it may be incomplete, but it runs and has at least one test |
| **Sat 7 Nov** | **Integrated mock MVP** | Through R5's API, on mocks: request → follow-up questions → `TaskSpec` → 3 concurrent mock calls → `CallResult`s stored → quotes → comparison → every event in order over SSE → R7's UI, with no manual refresh. One failed call doesn't stop the other two. Mocks stand in for any component that isn't ready: the MVP doesn't require every role's component to be complete. (This is Gate A-mock and Gate B-mock) |
| **Thu 12 Nov** | Full integration checkpoint + **Gate C** | Every component that needs no API key is real; mocks remain only where a key is missing. Gate C decided (below) |
| **Sat 14 Nov** | **Feature freeze** | Bug fixes only. Real providers may still be activated and validated afterwards under the policy in §4 |
| **Wed 18 Nov** | Internal submission-ready target | Final README, metrics, slides, demo and recorded fallback. If keys are still missing, we submit on mocks and **say so plainly**; we claim no metric we didn't measure |
| **Thu 19 Nov** (provisional) | Expected submission, end of KSU Week 13 | Date to be confirmed by the AI track leader. Days between 18 Nov and the deadline go to evaluation and rehearsal, not features |
| **Thu 10 Dec** | Tuwaiq showcase (separate from the KSU submission) | Real-provider work and real-call evaluation that missed the submission is finished here |

**Gates:**
- **Gate A (real), "we can make a call":** one controlled call completes and its transcript is
  stored against a `TaskSpec`. Blocked until ElevenLabs + Twilio; run within 2 working days of the keys.
- **Gate B (real), voice stack:** stay on ElevenLabs if real test calls connect and Scribe's
  number accuracy on phone-quality clips is acceptable. A switch needs clear evidence, and
  nothing switches after Thu 12 Nov.
- **Gate C, car repair stretch (Thu 12 Nov):** only if electronics and stock checks run end to end
  and, on labelled calls, critical-field accuracy ≥ 85% and hallucination ≤ 2%. Without real
  labelled calls Gate C is **no**, and cars are listed as future work.

## 2. Deliverables by role

Read your section, then [integration.md](integration.md) for the Python interface you
implement. "Blocked" items wait for API keys (§3).

### R1: planner, orchestrator, integration
- **Done:** planner, orchestrator, mocks, demo, contract validation, `integration.md` (PRs #5, #6).
- **Fri 6:** review every first PR within a day; unblock interface questions.
- **Sat 7:** the MVP runs through R5's API with mocks; fix integration bugs on the spot.
- **Thu 12:** contract proposal for backup shops (§5), and its implementation if approved;
  integrate each real component as it lands; Gate C decision record.
- **Blocked:** real request understanding (LLM key).

### R2: voice agent
- **Fri 6:** agent configuration as code in `app/voice/` and `prompts/` (prompt, first message,
  call flow, user questions, honest "are you a robot?" answer, voicemail/IVR rule, English
  switch) and a function `CallJob` → agent settings, tested on `contracts/examples/call_job.json`.
- **Sat 7:** call flow checked against R3's scenario cards on paper (read aloud as a role-play with R4).
- **Thu 12:** push-to-ElevenLabs script written and reviewed; every scenario card walked through;
  ready to push the day keys arrive.
- **Blocked:** pushing the agent, choosing the voice, LLM A/B, any call.

### R3: speech recognition + evaluation
- **Fri 6:** Arabic normalization + number parser ("ثلاثمية وخمسين" = 350) with tests; scenario cards.
- **Sat 7:** metrics script v0 printing the [evaluation table](architecture.md#8-evaluation)
  from fixture `CallResult`s, `Quote`s and labels (skipping `mock_*` data in real runs).
- **Thu 12:** labelling sheet and two-labeller process ready; SADA phone-simulation script; the
  benchmark ready to run in one day once keys exist.
- **Blocked:** the speech benchmark (Scribe, Deepgram), the fake shopkeeper (LLM), labelling real calls.

### R4: telephony
- **Fri 6:** allowlist check (refuse any other number); mapping from Twilio/ElevenLabs call
  statuses to our `outcome` values, tested on hand-written status payloads. Email Unifonic.
- **Sat 7:** your `RetryPolicy` (max one retry after 10 min, calling hours) used by the
  orchestrator in the mock pipeline.
- **Thu 12:** `docs/telephony.md` test plan (caller ID, number types, outcomes); Unifonic's answer
  recorded; the call provider written against the interface. Until we have API access, test it
  on **representative synthetic responses** (hand-written from Twilio's and ElevenLabs' public
  docs, marked as synthetic); replace them with saved real responses once keys arrive.
- **Blocked:** Twilio account, caller-ID test, every real call, reach rate.

### R5: backend + discovery
- **Fri 6:** `POST /tasks` and `POST /tasks/{id}/answers` working on the mock planner.
- **Sat 7:** `POST /tasks/{id}/start` (using `orchestrator.start()`) runs a full mock task;
  `GET /tasks/{id}/events` streams it over SSE with replay (the in-memory sink is fine).
- **Thu 12:** Postgres tables and a Postgres event sink following the storage rule; Places
  request builder + "pick shops" logic tested on a hand-written Places response; cost per call.
- **Blocked:** real Places searches.

### R6: extraction + comparison
- **Fri 6:** evidence checker with tests on `contracts/examples/quote.json`.
- **Sat 7:** your real `Comparator` replaces R1's mock in the mock pipeline.
- **Thu 12:** `Extractor` (prompt + parser tested on fake LLM replies) with the evidence checker
  applied; written per-category rules for a **usable quote** (e.g. electronics: a verified
  relevant price; stock check: verified availability).
- **Blocked:** real LLM extraction, the ElevenLabs baseline experiment, hallucination numbers.

### R7: frontend + demo
- **Fri 6:** UI plays the example event sequence (`contracts/examples/events/`) or a demo
  stream (`python -m app.mocks.demo --json`).
- **Sat 7:** UI driven live by R5's SSE on a mock task, no manual refresh.
- **Thu 12:** evidence view (value + quote + transcript turn), can't-compare, failed and partial
  states; demo script draft.
- **Blocked:** nothing until the dashboard needs real metrics.

## 3. Blocked by API access

| Needs | Blocked work | Until then |
|---|---|---|
| ElevenLabs + Twilio | Gates A and B, every real call, caller-ID test, role-play calls over the phone, reach rate, labelled calls | mock calls, scenario cards, paper role-plays |
| Scribe / Deepgram | speech benchmark | clips and scripts ready to run in one day |
| LLM API | real planning, extraction, fake shopkeeper, live-call LLM A/B | mock parser, fixture quotes, prompts and parsers tested on fake replies |
| Google Places | real discovery | mock shops, parser tested on a hand-written response |

**Biggest risk: evaluation.** At least 50 labelled calls by the freeze needs real calls from about
**Sun 8 Nov**. If keys arrive by Thu 12 Nov, we make a smaller set of pre-arranged calls, report
it with its size, and Gate C is no. If they arrive after the freeze, we submit on mocks with the
honest note above and move real calls to the showcase. We never pad results with mock data.

## 4. Mocks and real providers

Every external service sits behind one interface; signatures are in [integration.md](integration.md).

| Interface | Mock today | Real implementation | Owner |
|---|---|---|---|
| `RequestParser` | keyword lexicon | `LLMRequestParser` + an LLM client | R1 |
| `AreaResolver` | 5 Riyadh districts | UI map pin / district choice, or geocoding (owner still open) | R7 or R5 |
| `DiscoveryProvider` | 3 fictional shops | Places Text Search | R5 |
| `CallProvider` | scripted calls per scenario | ElevenLabs Agents + Twilio | R4 + R2 |
| `RetryPolicy` | never retries | max one retry, calling hours | R4 |
| `Extractor` | fixture quotes | LLM extraction + evidence checker | R6 |
| `Comparator` | lowest price only | like-for-like comparison | R6 |
| `EventSink` | in-memory, with replay | Postgres + SSE | R5 |

**Rules:** mocks live only in `app/mocks/` and tests; every mock passes the schemas; mock mode
makes no network calls and refuses any number except `+9665000000NN` fixtures; mocks and real
providers are swapped only in R5's startup wiring; mock results are never reported as results.

**Replacing a mock** (the provider's owner, in order):
1. Key goes in `.env`, never in git. R1 checks the spend against the $500 budget first.
2. Write the adapter in your own folder, implementing the interface; validate its output with
   `app.contracts.validate`.
3. Test it without the network on a saved response (no personal data). Before access, a
   representative synthetic response built from the provider's docs is fine; swap in a real
   one when you have it. CI never calls a paid API.
4. Smoke test by hand, behind a flag, to allowlisted numbers only.
5. Switch it on in R5's wiring (`PROVIDER_MODE=mock|real`, mock by default; real mode refuses to
   start without its keys). Mocks stay for CI, demos and the recorded fallback.

Suggested order once keys exist: LLM → ElevenLabs + Twilio → Places.

**Activation policy.** A real provider is switched on only when **all** of these hold:
- its adapter and parsing tests are merged, and the full test suite is green;
- it sits behind `PROVIDER_MODE`, mock by default;
- a **controlled live smoke test** passed and is written down with its date in `docs/`: 3 calls to
  allowlisted numbers, 5 Places searches, or 10 extractions on role-play transcripts;
- rollback is one step: set the flag back to mock.

A saved response proves the parsing, not the connection or its reliability; only the smoke test
does. After the 14 Nov freeze, **activation and validation** (flags, keys, smoke tests, fixes that
make an existing adapter work) are allowed; **new behaviour** is a feature and is not.

## 5. Approved next step: backup shops (not implemented)

Today a task calls at most 3 shops and stops, however many usable quotes it got. Approved
direction: discover ~6 candidates, keep at most 3 calls running, and replace a shop that gives no
usable quote with the next one, until 3 verified usable quotes or a limit is reached.

It starts after the 7 Nov MVP and needs, in order: R1's `contract-change` proposal (target usable
quotes, max businesses, max parallel calls and max attempts as separate settings, with the
migration for R5 and R7), R6's usability rules, then the implementation. Like any feature it must
land before the 14 Nov freeze, or it becomes future work.
