# Voice Quote Agent

An AI voice agent that phones 3 nearby shops in parallel in Saudi Arabic (English fallback) to get repair quotes or check stock, asks the user's own questions, backs every value with the shop's exact words, and compares the shops.

**Start here: [docs/architecture.md](docs/architecture.md)** (read it fully, then your own role section).

## How we work
- Branch per topic: `r<role>/<topic>` (e.g. `r4/caller-id-test`). Only change your own folders (see architecture §5).
- Small PRs, one topic each. Every PR description has **What / Why / How I verified**.
- Your backup reviews your PR; `main` only changes through a pull request.
- **Never commit** `.env`, API keys, call audio or transcripts. Keep them in `data/` (gitignored).
