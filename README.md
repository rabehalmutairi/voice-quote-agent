# Voice Quote Agent

A voice agent that phones nearby shops at the same time, in Saudi Arabic (English fallback), to
get repair quotes or check stock. Every value it reports is backed by the shop's exact words,
and it compares the shops or says why they can't be compared.

## Status (18 Nov 2026)

**The full flow runs end to end on mocks**, in the terminal and in the web app: request →
follow-up questions → task → up to 3 calls at once → quotes backed by the shop's words →
comparison → live events in the UI. CI runs 726 Python tests and the web app's lint, unit
tests and build on every PR.

- **Merged, tested and used by the app:** planner (R1), orchestrator (R1), contracts and
  templates (R1), backend API and live events (R5), web app (R7).
- **Merged and tested, not connected to the app yet:** voice-agent configuration (R2),
  evaluation tools (R3), Twilio + ElevenLabs call provider (R4), evidence-checked extractor
  and like-for-like comparator (R6). The app still uses the mock calls, mock extractor and mock
  comparator (`build_mock_stack` in `app/api/main.py`).
- **Real voice tests so far:** an ElevenLabs test agent with a Saudi voice, called from the
  browser (no phone line). The first call took 136 s with 6 questions; after
  [#20](https://github.com/rabehalmutairi/voice-quote-agent/pull/20) (shorter calls) it took
  54 s and finished correctly. When asked, the agent says it is an AI. These are a handful of
  tests, **not an evaluation**: we have no labelled real calls and report no accuracy metrics.
- **Blocked:** Twilio refused our Saudi number at sign-up, so no phone calls yet. There is no
  LLM or Google Places access, so planning, extraction and discovery use mocks.
- **Pending approvals:** the written AI-disclosure approval and the recording/transcription
  (PDPL) sign-off from Tuwaiq.
- **Not in this submission:** car repair (Gate C is no: no labelled calls), *Quick Call*
  (designed in [ADR 002](docs/decisions/002-two-mode-product.md); the web app shows a
  browser-only preview, with no backend), and backup shops. These move to the 10 Dec showcase.

## Quick start

Python 3.11+ (we use 3.12).

```bash
python -m venv .venv
.venv\Scripts\activate                 # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest                       # all tests (CI runs the same)
python -m app.mocks.demo               # a full task on mocks: request -> 3 calls -> comparison
python -m app.mocks.demo --scenario one_failed
```

Web app (Node 20.19+; CI uses 26), against the mock backend:

```bash
python -m uvicorn app.api.main:app --port 8002   # terminal 1
cd web && npm ci && npx vite --port 5173         # terminal 2, then open http://localhost:5173
npm run lint && npm test && npm run build        # what CI runs for web/
```

Other scenarios: `all_failed`, `timeout`, `retry`, `provider_error`, `no_shops`.
`--json` prints only the events, one JSON object per line. Mocks make no network calls and
use fake phone numbers, so nothing costs money.

## Your role

**Every member:** first working PR by **Fri 6 Nov** (incomplete is fine; it must run and have
a test). **Sat 7 Nov** is the integrated mock MVP: the whole flow runs end to end, with mocks
standing in for any component that isn't ready. It does not require every role's component
to be complete; plug in what works.

| Role | Owner | Work in | Read first | Your deliverables |
|---|---|---|---|---|
| **R1** Planner, orchestrator | Rabeh | `app/planner/`, `app/orchestrator/`, `app/mocks/`, `contracts/`, `templates/`, `docs/` | all of the below | [plan: R1](docs/mock-first-plan.md#r1-planner-orchestrator-integration) |
| **R2** Voice agent | Abdulmalik | `app/voice/`, `prompts/` | `templates/*.yaml` (`call_questions`), `contracts/examples/call_job.json`, [integration §4](docs/integration.md#4-r2-what-the-voice-agent-receives) | [plan: R2](docs/mock-first-plan.md#r2-voice-agent) |
| **R3** Speech + evaluation | Feras | `eval/` | `contracts/examples/call_result.json`, `quote.json`, [architecture §8](docs/architecture.md#8-evaluation), [integration §7](docs/integration.md#7-r3-telling-mock-data-from-real-data) | [plan: R3](docs/mock-first-plan.md#r3-speech-recognition--evaluation) |
| **R4** Telephony | Saleh Alrakban | `app/telephony/` | `contracts/call_job.schema.json`, `call_result.schema.json`, `app/orchestrator/interfaces.py`, [integration §3](docs/integration.md#3-r4--r2-callprovider-and-retrypolicy) | [plan: R4](docs/mock-first-plan.md#r4-telephony) |
| **R5** Backend + discovery | Omar | `app/api/`, `app/db/`, `app/discovery/`, `app/cache/` | `contracts/event.schema.json`, `business.schema.json`, `app/orchestrator/interfaces.py`, [integration §1–2](docs/integration.md#1-wiring-the-only-place-mocks-and-real-providers-meet) | [plan: R5](docs/mock-first-plan.md#r5-backend--discovery) |
| **R6** Extraction + comparison | Ahmed | `app/extraction/`, `app/comparison/` | `contracts/quote.schema.json`, `comparison.schema.json`, `contracts/examples/quote.json`, `templates/*.yaml` (`fields`), [integration §5](docs/integration.md#5-r6-extractor-and-comparator) | [plan: R6](docs/mock-first-plan.md#r6-extraction--comparison) |
| **R7** Frontend + demo | Saleh Aljarwan | `web/` | `contracts/examples/events/`, [integration §6](docs/integration.md#6-r7-the-event-stream) | [plan: R7](docs/mock-first-plan.md#r7-frontend--demo) |

Add tests for your code in `tests/<your area>/` (e.g. `tests/telephony/`). **Only change your own folders.**
Need a change in another folder, a contract or a template? Ask its owner (contracts and templates: R1).

## Before you code (about 15 minutes)

1. This page.
2. [docs/architecture.md](docs/architecture.md) §1–4 (what, scope, flow, key decisions) and
   your component in [§6](docs/architecture.md#6-components-and-ownership).
3. Your section of [docs/mock-first-plan.md](docs/mock-first-plan.md#2-deliverables-by-role).
4. [contracts/README.md](contracts/README.md), then the schemas and examples you produce or read.
5. Your section of [docs/integration.md](docs/integration.md): the exact Python interface to implement.

## How to submit work

1. Branch from `main`: `r<role>/<topic>`, e.g. `r4/outcome-mapping`.
2. Build and test against `contracts/examples/` and the mocks; check output with
   `app.contracts.validate("quote", obj)`.
3. Run `python -m pytest` before pushing.
4. Open a small PR (one topic) with **What / Why / How I verified** (paste the test output).
   Your backup reviews it ([backups](docs/architecture.md#6-components-and-ownership)); CI must be green.
5. Changing a contract? A `contract-change` PR, reviewed by R1 and every role that reads it
   ([how](contracts/README.md#changing-a-contract)).

Never commit `.env`, API keys, call audio or transcripts; keep them in `data/` (gitignored).
Blocked for more than a day? Tell R1 the same day.

## Using an AI coding assistant

Start your session with this, filled in for your role:

```text
I am R<n> (<role>) on the Voice Quote Agent repo. Before coding, read README.md,
docs/architecture.md §1-4 and my component in §6, my section of docs/mock-first-plan.md,
contracts/README.md, and my section of docs/integration.md.
Rules: work only in <my folders> and tests/<my area>/. Use the contracts in /contracts exactly; test against
contracts/examples/ and app/mocks. Do not change contracts, templates, app/planner,
app/orchestrator or another role's folder: ask me first. Explain your plan before writing
code, and run `python -m pytest` before you finish.
```

You must understand every line you push: your backup will ask in review.

## Blocked until phone and API access

Phone calls (Twilio), the speech benchmark on phone-quality audio, LLM planning and extraction,
real Places searches, and evaluation on real calls. Details and fallbacks:
[plan §3](docs/mock-first-plan.md#3-blocked-by-api-access).

## Where things live

| What | Source of truth |
|---|---|
| Setup, onboarding, workflow | this README |
| Scope, architecture, ownership, evaluation, privacy rules | [docs/architecture.md](docs/architecture.md) |
| Deliverables, deadlines, gates, mock-to-real policy | [docs/mock-first-plan.md](docs/mock-first-plan.md) |
| Python interfaces and backend wiring | [docs/integration.md](docs/integration.md) |
| Data formats | `contracts/*.schema.json` (examples in `contracts/examples/`) |
| Contract conventions and rules a schema can't check | [contracts/README.md](contracts/README.md) |
| Category questions and fields | `templates/*.yaml` |
| Past decisions and why | [docs/decisions/](docs/decisions/) |

## Key dates

Thu 5 Nov checkpoint · Fri 6 Nov first PRs · **Sat 7 Nov integrated mock MVP** · Thu 12 Nov full integration + Gate C ·
**Sat 14 Nov feature freeze** · Wed 18 Nov internal ready · **Sat 21 Nov final submission** ·
Thu 10 Dec Tuwaiq showcase. Full table: [plan §1](docs/mock-first-plan.md#1-milestones).
