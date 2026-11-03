# Voice Quote Agent

An AI voice agent that phones 3 nearby shops in parallel in Saudi Arabic (English fallback) to get repair quotes or check stock, asks the user's own questions, backs every value with the shop's exact words, and compares the shops.

**Start here: [docs/architecture.md](docs/architecture.md)** (read it fully, then your own role section).

## How we work
- Branch per topic: `r<role>/<topic>` (e.g. `r4/caller-id-test`). Only change your own folders (see architecture §5).
- Small PRs, one topic each. Every PR description has **What / Why / How I verified**.
- Your backup reviews your PR; `main` only changes through a pull request.
- **Never commit** `.env`, API keys, call audio or transcripts. Keep them in `data/` (gitignored).

## Working without API keys (mock-first, from 3 Nov)
Our ElevenLabs, Twilio, Google Places and LLM subscriptions are delayed with no confirmed date. We keep building:
- Every external service sits behind a small Python interface that takes and returns **contract objects** (`/contracts`). Today a **mock** stands behind each one (`app/mocks/`, no network, fake numbers only); the real provider replaces it later without changing the code that calls it.
- **Most work starts now:** the planner, orchestrator, evidence checker, comparison, backend + SSE, UI, number parser, scenario cards, telephony outcome mapping and retry rules need no key.
- **Blocked until keys arrive:** real calls (Gates A and B), the speech benchmark, LLM planning and extraction, real Places searches, and real-call evaluation. These are marked as blocked, not done. Mock results are never reported as results.
- Milestones: **Thu 5 Nov** integration checkpoint · **Sat 7 Nov** full mock integration · **Thu 12 Nov** full integration + Gate C · **Sat 14 Nov** feature freeze · **Wed 18 Nov** submission-ready (KSU Week 13) · **Thu 10 Dec** Tuwaiq showcase (separate).

Your role's deliverables, the blocked list and how mocks become real providers: **[docs/mock-first-plan.md](docs/mock-first-plan.md)**.
