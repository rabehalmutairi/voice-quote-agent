# ADR 002: Two modes, one pipeline (Compare Shops + Quick Call)

Status: **accepted direction, 4 Nov 2026.** Implementation is not started. The contract change
below still goes through a `contract-change` PR. Owner: R1.

## Context

The product is a voice agent that calls local businesses to find out what the user needs to
know. The MVP compares up to 3 shops for electronics repair and stock checks. Users also want
to ask **one specific business** an ordinary question that isn't online ("do they print A2
posters today, and how much?"), in any category, without a template per product or service.

## Decision

**Two modes on one pipeline**:
`Planner → business selection / discovery → CallProvider → CallResult → Extractor → Comparator → events → UI`.
We add no second orchestrator, calling system, backend or schema family.

| | **Compare Shops (قارن لي)**, the MVP | **Quick Call (اسأل عني)**, new |
|---|---|---|
| Businesses | up to 3 nearby, found by discovery | **1, chosen by the user** from discovery candidates |
| Questions | the category template's typed fields (+ up to 2 user questions) | 1–2 questions the planner extracts from the request |
| Result | evidence-backed `Quote`s + ranked `Comparison` | one evidence-backed answer (`Quote.answers`); `Comparison` is `side_by_side` with no ranking |
| Categories | `electronics_repair`, `stock_check` (car repair stretch) | `general_inquiry` (any ordinary business question); a structured category may also be used for one business |

**Scope.** Information only: availability, prices, specs and variants, warranty, service
offered, turnaround, other ordinary questions a business answers by phone. **Out of scope:**
bookings, orders, payments, sharing personal data, accounts or identity checks, negotiating or
accepting terms, personalised medical/financial/legal questions, private individuals, and
dialling numbers the user types.

**Callable numbers.** Only direct local **mobile and landline** numbers. 920 unified numbers
and 800 toll-free numbers are skipped: no IVR or menu navigation. The user is told plainly
when their chosen business can't be reached. A chosen business is never swapped for another.
Allowlist and sign-off rules (architecture §9) are unchanged.

## Contract change (the smallest coherent one)

**Reused unchanged:** `CallJob` (the inquiry travels in `custom_questions`; `dynamic_variables`
may be `{}`), `CallResult`, `Quote` (`offers: []`, `fields: {}`, and `answers` already carry
free-form, evidence-backed replies), `Comparison` (`side_by_side` already means "usable answers,
nothing to rank"), `Business` (`number_type` already distinguishes 920/800), `Event` (same
sequence; `business.found` for the chosen business), and every interface signature in
`app/orchestrator/interfaces.py`.

**Where today's contracts conflict with a generic inquiry:**
1. `template.schema.json` requires at least one field, call question, required field,
   `compare_on` entry and Places query. An inquiry template has none of these, and a
   `general_inquiry.yaml` with dummy fields would be a hack that R6 and the comparator would
   then mistake for real data.
2. `TaskSpec` cannot say "call *this* business". Discovery always picks shops itself, and the
   orchestrator always calls what discovery returns.
3. The orchestrator and comparators assume structured data: the mock comparator returns
   `cannot_compare` ("no exact price") for a successful answer-only call.

**The change** (one `contract-change` PR, reviewers R5, R6, R7, R2):
- `template.schema.json`: add `kind: structured | inquiry`. `structured` keeps today's
  minimums. `inquiry` requires `fields: {}` and empty `offer_fields`, `quote_fields`,
  `call_questions`, `required_fields`, `compare_on` and Places queries. The 3 existing templates
  get `kind: structured`. New `templates/general_inquiry.yaml` with `kind: inquiry` and one
  planner question, `area`.
- `TaskSpec`: add **one key**, `target`: `null` (Compare Shops) or
  `{ "query": "محل طباعة", "business": null | Business }`. Rules: `target` set ⇒
  `max_businesses = 1`; ready ⇒ `target.business` is set. Until the user chooses, `"business"`
  sits in `missing_slots`, so the existing `task.needs_input` event asks for it.
- Examples and contract tests updated together, with broken cases (target with
  `max_businesses: 3`, ready with no business, `inquiry` template with a field).

Rejected alternatives: a separate `GeneralTaskSpec`/`GeneralCallJob` family (duplicates the
pipeline); a new "task.done" event (`comparison.ready` + `side_by_side` already ends a task);
storing the selection only in R5's database (the TaskSpec would no longer say whom we call).

## Boundaries enforced in code, not by the LLM

The LLM interprets the request: mode, business type, and the 1–2 questions. Code decides:
- **Which business:** only one returned by our discovery for this task can be selected
  (`orchestrator.select_business(task_id, place_id)` checks the stored candidates). A phone
  number from the client is never used.
- **Callable or not:** `number_type` must be `mobile` or `landline`, in both modes.
- **Outbound content:** the existing policy check (`app/planner/policy.py`) on every question;
  it stays a small rule, not a verb dictionary.
- **No call before confirmation, at most 1 call (Quick Call) or 3 (Compare), at most one
  retry**, the same timeouts, cost cap, cancellation and event order.
- **Evidence:** every answer's quote must be in a shop turn (R6's checker). An answer without
  evidence is `not_mentioned`, never guessed.

## Implementation slices

**Nothing changes before the Sat 7 Nov MVP.** Nov 6–7 deliverables stay as they are.

| # | Owner | Work | Acceptance |
|---|---|---|---|
| 1 | R1 | `contract-change` PR (above), `general_inquiry.yaml` | schemas, examples and tests green; R5/R6/R7/R2 approve |
| 2 | R1 | Planner: mode, `target.query`, 1–2 extracted questions, `business` missing slot; LLM response shape. Orchestrator: `find_candidates(task_id, limit=5)`, `select_business(task_id, place_id)`, target path (no discovery, 1 call), number-type filter in both modes. Mocks: a fictional printing shop (+ a 920 shop), its script, mock comparator → `side_by_side` for inquiries; demo `--scenario quick_call` | offline: request → candidates (920 shown as not callable) → select → confirm → 1 call → `quote.ready` with an evidence-backed answer → done; no-answer, 920 and out-of-scope cases fail clearly |
| 3 | R5 | `GET /tasks/{id}/candidates` → `find_candidates`; `POST /tasks/{id}/business` → `select_business`; discovery uses `target.query` + area | routes work on mocks |
| 4 | R7 | Mode choice, candidate picker (callable / not callable), confirm screen, answer card with the shop's quote | mock Quick Call plays with no manual refresh |
| 5 | R6 | Extractor: answers-only path for `inquiry`; comparator: `side_by_side` for a single quote | the printing-shop fixture gives a valid answer with evidence |
| 6 | R2 | Agent: with no template questions, open with the user's question phrased naturally; ask nothing else | paper walkthrough of R3's inquiry scenarios |
| 7 | R4 | Provider refuses 920/800 (second line behind the orchestrator); `ivr` outcome as today | unit test |
| 8 | R3 | 10–15 offline inquiry scenarios (straightforward, price, availability, non-electronics, variants, unavailable, unclear, busy, failed call, 920, ambiguous business, out-of-scope, unsupported claim); faithfulness and evidence metrics | metrics run on fixtures; never reported as real-call results |

**Schedule:** slices 1–2 Sun 8 – Tue 10 Nov; 3–8 are small and start once slice 1 merges.
**Go/no-go at the Thu 12 Nov checkpoint:** Quick Call ships before the 14 Nov freeze only if
slices 1–2 are merged and 3–5 work on mocks without delaying Compare Shops. Otherwise it is
demonstrated at the 10 Dec showcase. Real Quick Call calls follow the activation policy like
any other provider work.

**Priority order** (when time is short): working MVP → reliable calls and integration → Arabic
quality and truthful extraction → Quick Call → backup shops (plan §5) → car repair → IVR/920
support (future work).

## Consequences

- One pipeline, one set of events and one UI flow with a mode switch; no new services or dependencies.
- TaskSpec gains one nullable key; templates gain `kind`. Producers that ignore Quick Call only add `"target": null`.
- Backup shops move behind Quick Call in priority.
- Risks: late contract review (mitigation: additive, defaults to null, decided at the 12 Nov
  gate); unfaithful answers to open questions (evidence check, at most 2 questions, R3
  faithfulness eval); wrong or unreachable business (selection only from our candidates, user
  confirmation, number-type filter, never auto-replace).
