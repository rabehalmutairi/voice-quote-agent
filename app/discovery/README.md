# Phase 4 — Shop discovery with sample data

From the project folder in PowerShell, run:

```powershell
.\.venv\Scripts\python.exe -m app.discovery.demo
.\.venv\Scripts\python.exe -m app.discovery.demo --limit 3
```

The first run should pick **ورشة الجوالات التجريبية** (mobile) and **مركز الشاشة التجريبي** (landline). It shows why the other entries were skipped: a duplicate, missing or unusable numbers, a closed shop, 920/800 numbers, and a third eligible shop beyond the limit. With `--limit 3`, **ورشة احتياطية تجريبية** should also be selected.

The demo passes a [hand-written response](examples/al_malqa_places.json) to the same adapter the backend will use for discovery. The sample names and numbers are fictional, and the demo replaces the network connection. You do not need the API server, PostgreSQL, or a Google key to run it.

The adapter uses the category search terms and biases results toward the task area. It preserves Google's order among eligible shops and tries the next template term if it needs more shops. Google treats the area as a preference, so the request does not enforce a strict geographic boundary. It follows [ADR 002](../../docs/decisions/002-two-mode-product.md) and returns only direct mobile or landline numbers. Live Places verification and provider wiring are Phase 6.

References: [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search) and [Saudi national numbering plan](https://www.cst.gov.sa/en/about/Numbering).
