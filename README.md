# Voice Quote Agent

An AI voice agent that phones 3 nearby shops in parallel in Saudi Arabic (English fallback) to get repair quotes or check stock, asks the user's own questions, backs every value with the shop's exact words, and compares the shops.

**Start here: [docs/architecture.md](docs/architecture.md)** (read it fully, then your own role section).

## Run it (no API keys needed)
```bash
python -m venv .venv && .venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest                                     # contracts, planner, orchestrator, end-to-end
python -m app.mocks.demo                             # request -> 3 concurrent mock calls -> comparison
python -m app.mocks.demo --scenario one_failed       # also: all_failed, timeout, retry, provider_error, no_shops
```
The demo runs the real planner and orchestrator against mock providers (no network, fake numbers, no cost).
Plugging your component in: **[docs/integration.md](docs/integration.md)**.

## How we work
- Branch per topic: `r<role>/<topic>` (e.g. `r4/caller-id-test`). Only change your own folders (see architecture §5).
- Small PRs, one topic each. Every PR description has **What / Why / How I verified**.
- Your backup reviews your PR; `main` only changes through a pull request.
- **Never commit** `.env`, API keys, call audio or transcripts. Keep them in `data/` (gitignored).
