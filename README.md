# Voice Quote Agent

An AI voice agent that phones 3 nearby shops at the same time in Saudi Arabic (English fallback) to get repair quotes or check stock. It also asks the user's own questions, backs every value with the shop's exact words, and compares the shops.

> **Status (3 Nov):** our API subscriptions (ElevenLabs, Twilio, Google Places, LLM) are delayed. We build everything against **mocks** now and plug in the real services when the keys arrive. See [docs/mock-first-plan.md](docs/mock-first-plan.md).

## Start here (about 15 minutes)

Read these in order. You don't need anything else to start.

1. **This page.**
2. **[docs/architecture.md](docs/architecture.md)**: only §1–3 (what we build, the flow), §6 (the contracts) and **your own role in §8**. Come back to the rest when you need it.
3. **[docs/mock-first-plan.md](docs/mock-first-plan.md) §3**: your deliverables for Thu 5 Nov and Sat 7 Nov, and what is blocked.
4. **[contracts/README.md](contracts/README.md)**: the rules every piece of data follows.
5. Your row in the table below.

## Your files

| Role | Read | You build in |
|---|---|---|
| **R1** Planner, orchestrator | everything below; `app/planner/`, `app/orchestrator/` | `app/planner/`, `app/orchestrator/`, `contracts/`, `templates/`, `docs/` |
| **R2** Voice agent | `templates/*.yaml` (the `call_questions`), `contracts/examples/call_job.json`, [integration §4](docs/integration.md#4-r2-what-the-voice-agent-receives) | `app/voice/`, `prompts/` |
| **R3** Speech + evaluation | `contracts/examples/call_result.json` and `quote.json`, architecture §9, [integration §7](docs/integration.md#7-r3-telling-mock-data-from-real-data) | `eval/` |
| **R4** Telephony | `contracts/call_job.schema.json`, `call_result.schema.json`, `app/orchestrator/interfaces.py` (`CallProvider`, `RetryPolicy`), [integration §3](docs/integration.md#3-r4--r2-callprovider-and-retrypolicy) | `app/telephony/` |
| **R5** Backend + discovery | [integration §1–2](docs/integration.md#1-wiring-the-only-place-mocks-and-real-providers-meet), `app/orchestrator/interfaces.py`, `contracts/event.schema.json`, `contracts/business.schema.json` | `app/api/`, `app/db/`, `app/discovery/`, `app/cache/` |
| **R6** Extraction + comparison | `contracts/quote.schema.json`, `comparison.schema.json`, `contracts/examples/quote.json`, `templates/*.yaml` (the `fields`), [integration §5](docs/integration.md#5-r6-extractor-and-comparator) | `app/extraction/`, `app/comparison/` |
| **R7** Frontend | `contracts/examples/events/`, [integration §6](docs/integration.md#6-r7-the-event-stream) | `web/` |

**Only change your own folders.** Need something changed in another folder? Ask its owner.

## Repo map

```
docs/architecture.md     the whole design: scope, flow, contracts, roles, plan (source of truth)
docs/mock-first-plan.md  what each role does while the API keys are missing
docs/integration.md      how your code plugs into the planner and orchestrator
docs/decisions/          why we decided things (one short file per decision)
contracts/               the data shapes every part exchanges (JSON Schemas)
contracts/examples/      one valid example of each shape: build and test against these
templates/               one file per category (electronics_repair, stock_check, car_repair)
app/planner/             request text -> TaskSpec                                    (R1)
app/orchestrator/        runs a task: finds shops, 3 calls at once, quotes, comparison (R1)
app/mocks/               fake providers for every external service, no network       (R1)
app/contracts.py         validate(...) any contract object in one line               (R1)
tests/                   one folder per area; `python -m pytest` runs them all
```

## Run it (no API keys needed)

```bash
python -m venv .venv
.venv\Scripts\activate                  # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest                        # all tests
python -m app.mocks.demo                # a full task: request -> 3 calls at once -> comparison
python -m app.mocks.demo --scenario one_failed
```

The demo runs the real planner and orchestrator against mocks: no network, fake phone numbers, no cost.
Other scenarios: `all_failed`, `timeout`, `retry`, `provider_error`, `no_shops`. Add `--json` to print the raw events.

## How we work

- **Branch** per topic: `r<role>/<topic>`, e.g. `r4/caller-id-test`.
- **Small PRs**, one topic each. Every PR description has **What / Why / How I verified** (paste the test output).
- Your **backup reviews** your PR; `main` only changes through a pull request. CI must be green.
- Build and test against `contracts/examples/`. Check your output with `app.contracts.validate("quote", obj)`.
- **Never commit** `.env`, API keys, call audio or transcripts. Keep them in `data/` (gitignored).
- **Blocked for more than a day?** Tell R1 the same day.
- **Using an AI coding assistant?** Give it this README, `docs/architecture.md`, `contracts/README.md` and the files in your row above. Tell it to change only your folders and not the contracts. You must understand every line you push (architecture §12).

## Key dates

**Thu 5 Nov** integration checkpoint · **Sat 7 Nov** full mock integration · **Thu 12 Nov** full integration + Gate C · **Sat 14 Nov** feature freeze · **Wed 18 Nov** submission-ready (KSU Week 13) · **Thu 10 Dec** Tuwaiq showcase (separate)
