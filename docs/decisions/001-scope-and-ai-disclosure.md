# ADR 001: Wider scope, the user's own questions, and AI disclosure

Status: accepted, 27 Oct 2026. Owner: R1 (Rabeh).

## Context

`architecture.md` (22 Oct) promised electronics repair quotes only, with car maintenance as a stretch, and required the agent to say it is an AI in its first sentence. Since then the team lead asked for more:

- **Stock checks**: "عندكم آيفون 16؟", "عندكم MacBook Air M4؟"
- **Car repair** for specific requests (tires, lights), not open-ended diagnosis
- **The user's own questions**, which the agent asks and the system reports back in Arabic

Tuwaiq reviewed the ethics of the call and approved that the agent does not have to say it is an AI, for now.

## Decisions

### 1. Scope
| | |
|---|---|
| Committed (evaluated on labelled calls) | electronics repair quotes, stock checks |
| Stretch (Gate C, 12 Nov) | car repair, standardized requests only |
| Out of scope | open-ended diagnosis ("my car makes a noise"), bookings, payments |

Stock checks use the same shops, discovery and calls as electronics repair, so they cost little. Car repair adds its own scenario cards and labelling, so it stays behind Gate C. Principle from §2 still holds: if time gets tight we cut the stretch, never the evaluation.

### 2. The user's own questions
Up to **2 per task**, in any category. The agent asks them after the template's questions. Extraction returns a short Arabic answer (`Quote.answers[].summary_ar`) with the shop's exact words as evidence. Code verifies the quotes are real shop words; whether the summary is faithful to them is measured in the eval (R3), not guaranteed.

### 3. One engine, many templates
A template now declares its own typed fields (`number`, `choice`, `text`, `boolean`), so `Quote` is generic. Adding a category is a YAML file plus scenario cards, and `tests/contracts` proves a stock-check and a car-repair quote fit the same shape.

### 4. AI disclosure
- The agent **does not announce** that it is an AI. Tuwaiq approved this for now; revisit after testing and before any wider deployment.
- The agent **never claims to be human and never denies being an AI when a shop asks**. This is kept on purpose: it costs nothing, and a denial is the version that can harm the project with judges and under PDPL.
- Recording and transcribing calls (PDPL, retention) is a separate question from AI disclosure. The Tuwaiq/KSU sign-off in §11 / §13 still has to cover it.
- R2 adds a scenario test where the shop asks "إنت روبوت؟"; it fails if the agent denies being an AI.

## Consequences

- `architecture.md` §2, §3, §6, §7, §8, §10, §11 updated to match.
- Contracts v1: `custom_questions` in `TaskSpec` and `CallJob`, generic `Quote` (`offers`, `fields`, `answers`), `side_by_side` comparison status, typed template fields. `user_name` was removed from `CallJob`.
- More scenario cards for R3: stock check, the user's own question, "are you a robot?".

## TODO

- R1: attach Tuwaiq's written confirmation of the disclosure decision to this folder (no personal data), and confirm it covers call recording and transcription.
