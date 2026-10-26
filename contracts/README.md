# Contracts

The shapes parts of the system hand to each other (architecture §6). **These files are the source of truth.** If `docs/architecture.md` disagrees, the files win and the doc gets fixed.

| Contract | Schema | Example | Flow |
|---|---|---|---|
| TaskSpec | `task_spec.schema.json` | `examples/task_spec.json` | Planner → Discovery, Orchestrator |
| Business | `business.schema.json` | `examples/business.json` | Discovery → Orchestrator |
| CallJob | `call_job.schema.json` | `examples/call_job.json` | Orchestrator → Voice/Telephony |
| CallResult | `call_result.schema.json` | `examples/call_result.json` | Voice/Telephony → Extraction, Eval |
| Quote | `quote.schema.json` | `examples/quote.json` | Extraction → Comparison, UI |
| Comparison | `comparison.schema.json` | `examples/comparison.json` | Comparison → UI |
| Event | `event.schema.json` | `examples/events/<type>.json` | Backend → UI (SSE) |
| Template | `template.schema.json` | `/templates/*.yaml` | Config read by Planner, Voice, Extraction |

`common.schema.json` holds the pieces they share (IDs, timestamps, the evidence-backed field). The examples describe one story: task `tsk_01`, shop `ChIJexample01`, call `call_01`. Build and test against them.

## How to use them

- **Build against the examples.** Load `examples/*.json` as fixtures. You never need another role's code to start.
- **Check your output** against the schema (Python: `jsonschema`, JavaScript: `ajv`). Use a format checker, or `date-time` is silently ignored.
- **Run the tests:** `pip install -r requirements-dev.txt`, then `python -m pytest tests/contracts`.
## These are v0, not law

R1 drafted these before anyone had built against them. They are a starting point, and **you are expected to challenge them**: if a shape doesn't fit what you're building, or real calls show something missing, change it.

1. **Tell the group what broke.** One message: what you tried, what the contract made hard.
2. **Open a PR labelled `contract-change`** with the fix. Change the schema, the example, and `tests/contracts/test_contracts.py` together (add a test for the new rule, and a broken case that must be rejected).
3. **Reviewers are R1 and every role that reads the contract** (see the Flow column). Disagree in the PR, not in a side chat.
4. Merge when CI is green and those roles approve. Small, frequent changes beat one big rewrite.

Known open questions: how well `Quote` and `answers` fit real transcripts (R6, R3), and whether `CallResult` carries what Eval needs (R3).

## Conventions

- **Every key is always present.** "Not applicable" is `null`, never a missing key. Readers never need `if key in obj`.
- **`additionalProperties: false` everywhere.** A typo like `price_sr` fails validation instead of passing unnoticed.
- **Timestamps** are RFC 3339 in UTC with a trailing `Z`. **Phones** are E.164 (`+9665…`). **IDs** are prefixed (`tsk_`, `call_`); `place_id` is Google's.
- **Names** (`category`, slot keys, field names) are `snake_case`.
- **Evidence-backed fields** (Quote): `value` is set only when `status` is `found`. `found`, `refused` and `unclear` must carry `evidence_quote`, `evidence_turn` and `confidence`; only `not_mentioned` has them all `null`. Numbers hold either an exact `value` or a `value_min`/`value_max` range (e.g. "ساعة لساعتين"), never both. A field's type (number, choice, text, yes/no) and allowed choices come from the category template, not from the schema.
- **A Quote has `offers`** (one per option the shop quoted: part tier, variant, new or used), **`fields`** (values for the whole call) and **`answers`** (one per question the user wrote, same order as `custom_questions`, at most 2).
- **No personal data about the user** goes into a `CallJob` (architecture §11).

## Rules a schema cannot check

JSON Schema validates shape, not meaning. These rules are enforced in code, and that code owns them:

| Rule | Enforced by |
|---|---|
| `evidence_quote` appears in the transcript turn `evidence_turn`, and that turn is a **shop** turn (the agent repeating a price back is not evidence) | R6 evidence checker (whole-word match after Arabic normalization) |
| For prices, the number is actually in the quote | R6 evidence checker |
| A value that fails these checks is dropped and recorded in `evidence_issues` | R6 evidence checker |
| `TaskSpec.category` names a real file in `/templates` | Planner (R1) |
| `CallJob.to_number` is on the allowlist until sign-off | Telephony (R4) |
| Events for a task have increasing `seq` with no gaps | Backend (R5) |
| The ElevenLabs speaker `user` is converted to `shop` | Voice (R2), at the boundary |
| No call is placed while `TaskSpec.missing_slots` is non-empty | Orchestrator (R1) |
| Every value matches its field's type in the template, uses only that template's `offer_fields` / `quote_fields`, covers every `required_field`, and has `value_min` ≤ `value_max` | R6 (`template_problems` in `tests/contracts` is a starting point) |
| Each `answers[i].summary_ar` is faithful to its evidence quotes | R3 measures it in the eval; code can't check it |
| The agent never denies being an AI when asked (ADR 001) | R2 scenario test |

`tests/contracts/test_contracts.py` applies the evidence rule to the example Quote, so the examples themselves stay honest.

## Known limits (deliberate)

- v1 covers electronics repair, stock checks and (stretch) car repair as templates. Anything a template can't express is still open: raise it in a `contract-change` PR.
- A call is capped at 150 s (`max_duration_s`). With two custom questions that may be tight; R2 reports after the first role-play calls.
- No `schema_version` field: four weeks, one team; `contract-change` PRs are enough.
