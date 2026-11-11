# Call labelling sheet

Copy a sheet for each reviewer and attempt. Store completed sheets under `data/` with the
source records. Use IDs rather than names or phone numbers.

| Attempt | Value |
| --- | --- |
| Reviewer ID | |
| Task ID / Call ID / attempt | |
| Category and cohort | |
| Scenario ID if role-play | |
| Pre-arranged or cold | |
| Call outcome | |
| Whether R6 considers the returned quote usable | |
| Notes for adjudication | |

### Critical fields

Start with the shop's words and the category's required fields. Record each known value in
template units, with its scope and evidence. Enter one row per required field and offer.
Preserve ranges as `[min, max]`. Mark unmentioned, refused or unclear fields in the sheet and
leave those fields out of the numeric accuracy labels when no value can be established.

| Field | Offer / call-level | Value or status | Shop turn and quote | Returned field path |
| --- | --- | --- | --- | --- |
| | | | | |

### Returned values and summaries

For each returned `found` field, check that the transcript supports the value and its scope.
Check the ElevenLabs data-collection baseline on the same transcript and count its returned
values and unsupported values. For each returned `summary_ar`, check whether it faithfully
describes the shop's evidence, including conditions, uncertainty and refusals.

| System | Returned field path or custom question index | Supported / faithful? | Shop turn and reason |
| --- | --- | --- | --- |
| | | | |

### Reconcile and export

1. Two reviewers label independently. Hide the other reviewer's sheet. Record expected fields
   from the call before inspecting the extracted values to reduce anchoring.
2. Compare labels and re-check disagreements against the same audio and transcript. Document
   the agreed decision and the shop turn. If the reviewers cannot agree, leave that judgment
   unmeasured. Preserve both original sheets for the audit. For returned-field or summary
   audits, leave the entire audit for that attempt `null` until all its judgments are resolved.
3. Align each expected offer to the matching returned offer by identity, such as part tier or
   stock variant. A missing offer uses an unused index after the returned offers. A wrong value
   stays wrong at its aligned path. The script compares the agreed value at that path and
   counts a missing value as incorrect.
4. Use the current R6 per-category usability rule to set `usable`. Set it to `false` for a
   reviewed unusable quote or `null` when a returned quote has not been reviewed.
5. Copy the final review into the attempt's `labels` object. The [contract example labels](example_labels.json)
   show the format. `expected_fields` maps each adjudicated field path to its value.
   `unsupported_fields` lists every unsupported returned field path, and an empty array means
   the full audit found zero. `baseline` has `unsupported` and `returned` integer counts for
   the same attempt, or `null`. `answer_faithful` maps every returned summary's question
   index (as a string key) to a boolean, or is `null` before review.
