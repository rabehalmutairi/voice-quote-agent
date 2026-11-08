# Phase 5 — Reuse a recent shop answer

From the project folder in PowerShell:

```powershell
.\.venv\Scripts\python.exe -m app.cache.demo
```

The demo uses the existing simulated call system for one shop and runs three requests:

| Run | What you should see |
|---|---|
| First request | One simulated call. The answer is saved. |
| Same request again | The original answer, date, and shop's words. Zero new simulated calls. |
| Changed question | One new simulated call. The earlier answer cannot answer the changed question. |

The demo needs no running API, database, or external account. It starts with an empty cache every time.

## Prototype rules

- Reuse requires the same shop ID and phone number, category, item or repair details, and custom questions in the same order. A new task ID alone does not prevent reuse.
- Entries expire 24 hours after the original simulated call. A repeat request never refreshes the date. The prototype holds up to 256 entries in memory. The 24-hour window is provisional.
- A response must come from a conversation that reached a person. It must have the template's required fields backed by the shop's words and answers to all custom questions. Original task and call IDs and the transcript stay with the saved quote.

## API integration decision for R1 and R7

The current shared event format has no way to represent a reused answer. The call workflow emits a call-started event before asking the call provider for a result. Substituting the cached transcript there would show a new call to the user and misstate where the evidence came from. This prototype stays out of the shared API until the team agrees on the integration.

- **R1 and R6:** Propose a cache lookup after shop discovery and before scheduling each call. Call only misses. Compare the combined results, including when all shops are cache hits. Confirm the freshness window and eligibility rules per category. Keep mock and live entries separate.
- **R1 and R7:** Propose a reuse event carrying the current task and shop IDs, the original quote or a reference to it, and the original call time. The website can display “From <date>” with the original evidence and no ringing state. Agree on what to store and replay before enabling it through the API.
