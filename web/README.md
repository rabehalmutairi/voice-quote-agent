# Voice Quote Agent — R7 frontend

Arabic-first React interface for requesting repair quotes, checking stock, following shop-call events, comparing returned results and inspecting transcript evidence. All application files in this delivery live under `web/`.

## Delivery status

- Compare Shops runs against local mock tasks, including missing-input, failed, partial and cannot-compare outcomes.
- Quick Call is a local ADR 002 preview: choose a returned business, review the question and explicitly confirm before starting its simulated call. It does not claim the shared TaskSpec contract or R5 endpoints have been implemented.
- Quotes and inquiry answers show evidence from synthetic shop transcript turns. The UI renders the comparison it receives and does not calculate its own winner.
- `/metrics` contains explicitly simulated metrics; `/demo` provides repeatable fixture scenarios.
- Requests and drafts stay in session memory. Reloading the page starts a new session. Only the theme preference is stored locally.
- Real HTTP/SSE integration is pending R5's API and R1's approved contract changes. No live calls, external discovery or production metrics are enabled. This meets the first mock-frontend delivery; integrated SSE remains follow-up work.

See [QUICK_CALL.md](QUICK_CALL.md) for the local ADR draft and integration dependencies.

## Run locally

Tested with Node.js 24. From the repository root:

```bash
cd web
npm ci
npm run dev
```

Vite uses `http://localhost:5173` by default. No API keys or `.env` file are needed for the mock preview. Optional public browser configuration is documented in `.env.example`; never place secrets in `VITE_*` values. `VITE_TRANSPORT=mock` is the only implemented mode; selecting `real` fails clearly.

## Verify

```bash
cd web
npm ci
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Latest validation: 141 unit/component tests and 48 desktop/mobile Playwright cases passed, plus lint and production build. Responsive checks include 320–2560px, both themes and 200% text. These are browser checks, not a claim of a complete accessibility audit or physical-device/screen-reader testing. Details: [TESTING.md](TESTING.md).

## Review routes

| Route | Purpose |
|---|---|
| `/` | Service introduction and one clearly simulated offer |
| `/request` | Compare Shops or Quick Call request |
| `/tracking` | Active task state and missing-input questions |
| `/comparison` | Returned comparison, exclusions and evidence |
| `/demo` | Repeatable fixture scenarios |
| `/metrics` | Internal mock metrics |

Direct tracking/comparison links without a task show an unavailable state. For a repair demo, choose **استخدم مثالًا تجريبيًا** and submit. For Quick Call, choose **اسأل عني**, open **جرّب مثال الطباعة**, use the example, select a callable shop and confirm. The scripted reply only answers the supported A2 example; unsupported questions stay unclear.

## Architecture and scope

React/JavaScript, Vite, React Router, plain CSS, runtime payload validation, event-derived state, separated transport hooks and accessible evidence dialogs. Components do not call backend endpoints directly. Contracts in the repository root remain unchanged. Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for boundaries.

The default locale is `ar-SA` and RTL. Noto Sans Arabic is hosted locally under `public/fonts/` with its OFL license. Screenshots use synthetic data:

- [Desktop introduction](docs/screenshots/landing-desktop.png)
- [Mobile introduction, light theme](docs/screenshots/landing-mobile.png)
