# R3 speech and evaluation

Run from the repository root with Python 3.11+ and the packages in `requirements-dev.txt`.

```sh
python -m pytest tests/eval
python -m eval.metrics --example
python -m eval.scenarios repair_options greeting price warranty time availability custom_0
```

The example report reads the repository's `CallResult` and `Quote` examples with synthetic
labels. Use it to check the report format. Actual metrics require a separate labelled bundle.

## Collect and report call metrics

1. Save each attempt's `CallResult`, or the `call.failed` event when there is no provider
   result. Keep failed first attempts even when a retry works. The final SSE stream and R5's
   stored call record only expose the final outcome per call, so retain attempt-level provider
   results during the evaluation run.
2. Keep source bundles under gitignored `data/`. Use separate bundles for consenting shop calls,
   phone role-plays and text simulations. Keep the original `scenario_id` on all mocks. For phone
   role-plays, record the card ID after the call. See the repository's consent and retention rules.
   [Architecture §9](../docs/architecture.md#9-ethics-privacy-and-safety-non-negotiable)
3. Use the [labelling sheet](labelling.md) for two independent reviews, then copy the agreed
   values into the attempt bundle and run:

```sh
python -m eval.metrics --input data/attempts.json
```

The input is a JSON array. Each item contains these keys:

| Key | Value |
| --- | --- |
| `category` | The original task's template category |
| `attempt` | `1` or `2`, from the CallJob. Retries reuse the same IDs and must have the failed first attempt in the bundle. |
| `call_result` | The original [CallResult](../contracts/examples/call_result.json) object |
| `call_failed` | The original [failure event](../contracts/examples/events/call.failed.json), used in place of `call_result` when no result exists. Also supply `pre_arranged`, `scenario_id` and, if known, `cost_usd` from the attempt log. |
| `quote` | The original [Quote](../contracts/examples/quote.json) for this attempt, or `null` |
| `labels` | Reconciled labels from the [sheet](labelling.md). Omit or use `null` before review. |
| `observations` | Optional observed `turn_latency_s` (list of seconds), `language_switch_ok` (boolean for an applicable switch) and `task_elapsed_s` (seconds for the whole request, counted once per task) |

Reach counts attempts. Completion counts only attempts that reached a person. Critical-field
accuracy compares all labelled required values, including values the extractor missed. Label a
missing expected offer at a new index after the returned offers. The overall rate weights each
labelled value equally. The hallucination denominator counts every `found` offer or call-level
field on audited calls. Baseline and app rates are compared on the same calls. Faithfulness has its
own denominator of human-reviewed summaries. Cost includes all attempts in the bundle and is
reported when costs and quote usability are known and at least one task has two distinct usable
shops. Report the sample counts with any result. Records with `scenario_id` starting with
`mock_` are excluded from all calculations. [Architecture §8](../docs/architecture.md#8-evaluation)

## Role-play and shared text helpers

The [scenario cards](scenario_cards.yaml) give the shopkeeper replies and the reviewer ground
truth. Give the caller the request and custom questions. Choose scripted reply topics as the
call progresses. An empty reply represents silence or hang-up. For free-text simulation,
`Shopkeeper.llm_reply(agent_turn, client, history)` accepts the team's async
`complete_json(system=..., user=...)` client. Review generated conversations against the card
before using them. The scripted simulator runs offline.

R6 can import `normalize`, `tokens` and `contains_words` from `eval.arabic`, and
`parse_numbers` and `number_in_text` from `eval.numbers`. The parser handles common Saudi
and English prices, digit forms, thousands, decimals and spoken ranges. Interpret units such as
hours and warranty months at the template layer. Context still matters for model numbers, prices
and unsupported number idioms.

## Run the paired speech benchmark

Use the [pilot runbook](pilot.md) to freeze the inputs, audit typed values by offer, and
compare extraction and live-call outcomes.

1. Select about 20 Saudi-dialect clips from the SADA held-out split and about 10 authorized
   Arabic phone-call clips. Record SADA clip IDs, dialects and selection method. Include examples
   with spoken numbers, and keep references and audio local in `data/`. SADA was released by
   SDAIA's National Center for AI and the Saudi Broadcasting Authority under CC BY-NC-SA 4.0.
   Attribute it and record the phone simulation as a modification. [SADA dataset](https://www.kaggle.com/datasets/sdaiancai/sada2022)
2. Use FFmpeg on `PATH` to create the SADA phone clips. Supply the original phone audio for the
   call cohort in mono WAV, and use recordings approved for both transcription providers.

   ```sh
   python -m eval.speech phone data/sada/clip01.wav data/asr/sada01.wav
   ```

   This applies 300 Hz high-pass and 3400 Hz low-pass filters and encodes mono 8 kHz G.711 μ-law.
3. Save a JSON array as `data/asr/manifest.json`. Give each clip a unique ID and set `source`
   to `sada` or `call`. `audio` is relative to the manifest, `reference` is the human
   transcript of that clip and `numbers` lists the numeric mentions in speaking order, with
   duplicates and digits in product names included when spoken. Use `[]` when there are no
   numbers. This row illustrates the format with fictional text:

   ```json
   [
     {
       "id": "sada01",
       "source": "sada",
       "audio": "sada01.wav",
       "reference": "السعر ثلاثمية وخمسين ريال",
       "numbers": [350]
     }
   ]
   ```
4. Set `ELEVENLABS_API_KEY` and `DEEPGRAM_API_KEY` in the environment. Run the benchmark,
   then use the cache to rescore after correcting reference labels:

   ```sh
   python -m eval.speech run data/asr/manifest.json
   python -m eval.speech score data/asr/manifest.json
   ```

The runner sends identical WAV bytes to batch Scribe v2 (`ara`) and Deepgram Nova-3
(`ar-SA`). It resumes completed requests from `data/asr-cache/` by clip ID, audio hash,
model and language. Use a fresh cache directory for a new measurement after a provider model
update. Batch transcription measures recognition on the chosen audio. Live agent quality
also needs controlled calls. [ElevenLabs transcription API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [Deepgram prerecorded API](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded), [Deepgram Saudi Arabic support](https://developers.deepgram.com/changelog/2026/1/27)

WER is total word edits divided by the number of reference words after the same normalization
on both sides. Number accuracy uses edit distance on the ordered numeric values. Each clip
contributes the larger of the reference and hypothesis number counts minus the numeric edits to
the numerator, and that larger count to the denominator. This gives credit for equal numeric
values in different written forms and penalizes extra numbers, including on clips with none
in the reference. The report shows the SADA and call cohorts separately as well as pooled.

After collecting transcripts, use `audit-sheet` to prepare the three columns for human review.
Once labelled, pass the sheet to `score --audit` for exact value matches by field and offer.

```sh
python -m eval.speech audit-sheet data/asr/manifest.json --output data/asr/audit.json
python -m eval.speech score data/asr/manifest.json --audit data/asr/audit.json
```
