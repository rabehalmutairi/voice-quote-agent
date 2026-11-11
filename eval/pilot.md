# R3 evaluation pilot

## Freeze the pilot

- Select about 20 held-out Saudi-dialect SADA clips and 10 approved call clips. Use different
  speakers where available. Log the selection rule and include noisy calls, overlapping speech,
  English switches, two prices for different offers, ranges and stock refusals. Keep scripted
  role-play and shop-call results distinct.
- Record clip IDs, call or speaker groups, dialect, and audio conditions locally. Freeze the
  manifest, audio hashes, reference transcripts, number and offer conventions, repo commit,
  provider settings, and run date before comparing systems. Use a dedicated cache for each run.
- Have two reviewers label the references independently. Resolve disagreements using the audio,
  then preserve both reviewers' originals and the adjudicated sheet. Record the number of clips
  and values reviewed with every reported rate. Follow the repo's consent and retention rules
  for the source audio and its transcripts.

[Call-domain Arabic ASR benchmark](https://arxiv.org/abs/2403.04280) ·
[Arabic MGB-3 benchmark](https://arxiv.org/abs/1709.07276) ·
[Inter-coder agreement methods](https://aclanthology.org/J08-4004/) ·
[Repository privacy rules](../docs/architecture.md#9-ethics-privacy-and-safety-non-negotiable)

## Compare speech providers

Run both providers on identical audio with the [speech benchmark](README.md#run-the-paired-speech-benchmark).
Use corpus word error rate and ordered number accuracy to diagnose transcription. Use the exact
value audit to measure the errors that matter to quote comparison, such as a warranty length
assigned to the wrong offer. Report SADA and phone results separately.

After collecting transcripts, export a sheet to gitignored storage:

```sh
python -m eval.speech audit-sheet data/asr/manifest.json --output data/asr/audit.json
```

The sheet contains the reference and both provider transcripts per clip. Review the reference
first without seeing provider outputs. Label the values in each provider transcript independently
of the reference labels. If possible, give reviewers transcript copies with provider names hidden.
Transfer the adjudicated labels back to the corresponding sheet columns. Keep the text as
exported so scoring can detect stale labels.

Each `mentions` entry names a field and the offer or item it belongs to. For example:

```json
[
  {"field": "price_sar", "scope": "original", "value": 1200},
  {"field": "price_sar", "scope": "commercial", "value": 450},
  {"field": "warranty_days", "scope": "commercial", "value": 30},
  {"field": "turnaround_minutes", "scope": "call", "value": [60, 120]},
  {"field": "model", "scope": "item", "value": "iphone_15_pro"}
]
```

- Agree on stable scope IDs across all three columns. Use `call` for call-wide values and an
  offer identifier such as `original` or `black_128` for offer-specific values. Record only one
  final value per field and scope. A repeated confirmation represents the same value.
- Supported fields are `price_sar`, `turnaround_minutes`, `warranty_days`, `capacity_gb`,
  `quantity` and `model`. Convert equivalent units into the field's units. Use a lowercase
  identifier for model values and an ordered two-number array for a stated numeric range.
- Use an empty array after confirming there are zero mentions in a column. Leave `null` for an
  unfinished or unresolved review. Scoring includes a clip only after all three columns are
  reviewed, and it reports the number included. The same inputs are used for both providers.
- A wrong value in the right offer counts as one missed reference and one extra prediction.
  The same value under the wrong offer is also a mismatch. Mention order has no effect.

```sh
python -m eval.speech score data/asr/manifest.json --audit data/asr/audit.json
```

The report gives matched, missed and extra counts, with precision and recall, overall and by
field. Treat the first set as exploratory. Once enough independent speakers or calls are
available, use paired confidence intervals that resample those groups together. Batch scores
compare saved audio transcription. Use controlled calls to validate streaming, interruptions,
language switching and hang-ups. [Paired ASR bootstrap](https://arxiv.org/abs/1912.09508)

## Evaluate extraction and call outcomes

- Configure the same field definitions for the ElevenLabs data-collection baseline and the app.
  Compare outputs on the same calls. Use a [reconciled label sheet](labelling.md) to score missing
  required values, unsupported returned values and unfaithful summaries.
- Run R6 extraction once on the provider transcript and once on the human-corrected transcript
  for a diagnostic subset. Keep the template and extractor configuration fixed. If a value only
  becomes correct with the corrected transcript, review the transcript difference and evidence
  before assigning the error to speech recognition.
- Run the scenario cards for repeatable behavior checks. Then record every attempt and retry in
  the approved call pilot. Report reach per attempt, completion among human answers, and time and
  cost per request. Keep pre-arranged and cold call results separate. Record the fraction of tasks
  with two distinct usable quotes.
- Report Gate C's critical-field and hallucination results with counts and uncertainty. A zero
  observed hallucination count in a small pilot can still be consistent with a rate above 2%.
  When values share a call, account for that dependence when estimating uncertainty.

[ElevenLabs data collection](https://elevenlabs.io/docs/eleven-agents/customization/agent-analysis/data-collection) ·
[Spoken-dialogue evaluation](https://aclanthology.org/P97-1035/) ·
[Gate C criteria](../docs/mock-first-plan.md#1-milestones) ·
[NIST binomial intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
