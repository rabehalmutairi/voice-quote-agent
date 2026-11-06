# R7: two-mode frontend preview

Implements the frontend slice of [ADR 002, commit 86afb44](https://github.com/rabehalmutairi/voice-quote-agent/blob/86afb4466f235a48a6f77e83ee4b878541841f92/docs/decisions/002-two-mode-product.md).
This local preview was requested on 4 November; the published plan schedules integration after the 7 November MVP and R1's contract-change PR.

## Local behavior

- `/request` offers Compare Shops and Quick Call. Quick Call uses synthetic printing-shop candidates and scripts. No network or real calls.
- Compare Shops accepts electronics-repair and stock-check drafts. Stock checks ask for `item`/area and select the existing stock fixture, rather than submitting repair slots.
- Request -> candidates -> select -> review -> explicit Start -> the existing task event reducer -> answer + shop evidence. Selection never starts a call. Double-start is rejected atomically.
- Only a candidate returned for the active task can be chosen. Mobile/landline candidates are enabled; 920/800 candidates explain why they cannot be selected. No typed phone number is dialled and no chosen business is substituted.
- Up to two questions. Outbound-content checks are best-effort UI feedback; authoritative enforcement belongs to the planner/orchestrator.
- The printing example has answered, no-answer and not-mentioned scenarios. Other business queries return an explicit empty state; only the normalized documented A2 example questions receive the scripted found answer. Other printing questions receive unclear, including A3 or fabric questions; no mock NLP is claimed.
- `InquiryAnswers` consumes published `Quote.answers`: `question_index`, `question`, `status`, `summary_ar`, `evidence[]`. Each quote must occur in a shop turn. `side_by_side` completes the same event stream without ranking.
- Task state remains in memory across request/tracking/comparison routes. Active task mode is distinct from the mode selected for the next request. Refresh starts a new session.

## External dependencies

`createInquiryDraft` and the Compare Shops request's `target: null` are **local ADR drafts**, not an assertion that the shared TaskSpec schema has changed. Do not send these objects unchanged to the current backend: R1's contract-change PR is still required. The planner owns IDs, timestamps, area resolution, category inference and extracting inquiry questions. This preview asks for explicit questions instead of claiming LLM planning.

`createQuickCallMockTransport` exposes planned `findCandidates(taskId)` / `selectBusiness(taskId, placeId)` capabilities. R5's future adapter maps these to `GET /tasks/{id}/candidates` / `POST /tasks/{id}/business`, maps canonical snake_case business fields into the frontend model, validates responses, and implements HTTP/SSE replay. No endpoint or server authorization is implemented here.

The mock delegates events to existing `createMockTransport`, `useTaskFlow` and reducer. It adds no second calling pipeline. Live extraction/comparison and provider restrictions remain owned by R6/R4.

## Presentation and checks

The desktop request workspace places introductory copy beside the form at 1100px and above; tablet/mobile layouts use one column. The content is capped at readable widths on ultrawide screens. Two service choices, optional repair details and answer evidence remain available. Shared tokens support dark/light themes, Arabic RTL, keyboard focus and reduced motion.

Run `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Browser coverage includes explicit confirmation, disabled number types, route continuity, evidence/Escape, failed/not-mentioned outcomes, 320–2560px layouts and enlarged text at 200%.

Drafts for both modes are held in session memory, independently of the active result. Demo scenario changes reset only demo work. New-task/reset clears the associated draft explicitly; navigation preserves it. Copy summaries preserve each option number, verified part label and evidence, without guessing missing values.
