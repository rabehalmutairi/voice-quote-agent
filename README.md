# Voice Quote Agent

An AI voice agent that calls 3 nearby phone-repair shops in parallel in Saudi Arabic (English fallback), extracts price / part type / warranty / repair time with evidence quotes from the transcript, and compares the shops.

**Start here: [docs/architecture.md](docs/architecture.md)** (read it fully, then your own role section).

## How we work
- Branch per topic: `r<role>/<topic>` (e.g. `r4/caller-id-test`). Only change your own folders (see architecture §5).
- Small PRs, one topic each. Every PR description has **What / Why / How I verified**.
- Your backup reviews your PR; `main` only changes through a pull request.
- **Never commit** `.env`, API keys, call audio or transcripts. Keep them in `data/` (gitignored).
