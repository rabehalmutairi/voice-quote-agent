# Frontend Architecture

For the local ADR 002 two-mode preview, provisional `target` drafts, planned provider methods and integration dependencies, see [QUICK_CALL.md](QUICK_CALL.md). Quick Call delegates the call lifecycle to the existing mock transport and event reducer. Discovery cards are no longer capped at three; call concurrency remains a backend responsibility.

## Goals

The frontend is an Arabic-first, responsive, accessible interface for creating a repair-quote task, following three calls live, comparing like-for-like offers, inspecting evidence, and presenting evaluation metrics. It must remain usable with fixtures before the backend is available.

## Boundaries

R7 owns `/web`. The frontend consumes, but does not own, shared schemas, planner logic, discovery, telephony, extraction, comparison, persistence, authorization, or provider webhooks.

The provisional schemas in `src/contracts` validate fixtures only. When R1 publishes canonical schemas, an adapter will map canonical API payloads into stable frontend view models. The frontend must not force its fixture assumptions into `/contracts`.

## Layers

```text
Pages and feature components
        ↓
Hooks / application state / event reducer
        ↓
Task transport interface
        ↓
Mock transport  |  Future HTTP + EventSource transport
        ↓
Runtime validation and canonical contract adapters
```

### UI

`src/pages` composes routes. Feature modules will own complete product capabilities. `src/components` contains genuinely reusable, accessible primitives. Components receive view data and callbacks; they do not know endpoint URLs.

### State

The reducer hydrates a validated task snapshot and tracks independent discovered shops; concurrency limits belong to the backend. It handles discovery, calling/talking, call completion/failure, quote-ready, comparison, partial, and task-failed states. The PR 2 fixture journey normalizes validated mock events through this reducer, and PR 3 retains synthetic transcript turns beside each quote for evidence inspection. A task snapshot is loaded before subscription so refresh and reconnection have a stable base. `TaskJourneyProvider` keeps separate product comparison, demo, and Quick Call flows alive at the app shell. Changing a demo scenario resets only the demo. `/tracking` and `/comparison` follow the most recently created task; selecting a mode for the next request does not replace the active task. Unsent drafts for both modes survive route changes in memory; a direct navigation or browser refresh without an active task renders an unavailable state instead of inventing results. No task data is persisted locally.

### Transport

The transport boundary is:

```js
{
  createTask(taskSpec),
  submitAnswers(taskId, answers),
  startTask(taskId),
  getTask(taskId),
  subscribe(taskId, onEvent)
}
```

`createTask` receives a validated frontend request object. Core fields follow TaskSpec; the local ADR target draft and its integration dependency are documented in QUICK_CALL.md. The mock transport also accepts a legacy string for focused compatibility tests, and the active form offers two input paths. Written mode sends only the user text/category and lets the fixture request missing fields. Structured mode sends typed slots/area and creates a readable request_text from those same user-supplied values plus an optional note; no second description or language inference is required. `subscribe` returns an unsubscribe function. PR 1 implements only the mock transport. The future real transport will use native `EventSource` after the backend contract and replay behavior are approved.

### Contract boundary

Runtime schemas reject malformed untrusted data, including nested business, shop, quote, evidence, comparison, and known-event fields. Adapter output uses frontend names and may add local metadata needed for rendering or replay. Current `eventId` and `sequence` fixture fields are explicitly provisional because the documented shared event contract does not yet define replay identifiers. Unknown events and events for another task are ignored without changing replay metadata.

## Routes

The public landing page is available at `/`, with the request workflow at `/request`. The repeatable fixture demo remains at `/demo`; tracking, comparison, and the fixture-only metrics dashboard are available at `/tracking`, `/comparison`, and `/metrics`. Tracking and comparison consume the active fixture task state, including shop lifecycle, evidence, missing offers, partial outcomes, and `cannot_compare` results. `/login` is a truthful sign-in placeholder until authorization is implemented. The former `/how-it-works` and `/about` paths redirect to their corresponding sections on the landing page so existing links continue to work. Later phases may add `/tasks/:taskId` and a production-backed dashboard after the backend boundaries are approved.

PR 5 metrics are derived from `src/mocks/metricsFixture.js` source records through the pure `src/features/metrics/deriveMetrics.js` helper. Latency uses every synthetic call in the source set, and cost per successful task uses total synthetic call cost divided by tasks meeting the local success criterion of at least two usable quotes. The dashboard must keep the simulated provenance notice and must not present these values as production measurements.

## Styling

CSS uses primitive and semantic tokens in `styles/tokens.css`. Components consume semantic roles rather than raw color values. Logical properties support RTL. The product uses restrained neutral surfaces, clear borders, visible provenance, and minimal motion instead of decorative AI styling.

## Accessibility and responsiveness

The default document is `ar-SA` and RTL. Mixed Latin content is isolated at the fragment level. WCAG 2.2 AA is the target. Designs are reviewed at 320, 375, 768, 1024, 1280, and 1440 pixels, with keyboard, reduced motion, 200% zoom, and screen-reader status behavior included in acceptance criteria. The header navigation remains visible and wraps at narrow widths; it does not collapse into a hidden menu. After a route change, focus moves to the new page's `<main>` landmark so keyboard and assistive-technology users have a reliable starting point.

## Future feature modules

Directories are created only when implementation begins. The task-flow feature covers request entry, clarification, task progress, and shop calls on fixtures. The comparison and evidence feature modules present the validated comparison result and transcript-backed quote fields. The metrics feature presents evaluation-shaped fixture data with persistent provenance labels; it must be replaced or adapted when R3/R5 production metrics are available. The demo route reuses the fixture task flow and keeps simulated data visibly separate from production data.

## Task-focused presentation (6 November 2026)

The header contains home, create request, and an active-task link only when a task exists. Tracking/result tabs live inside the task. Demo and metrics links remain in the footer, and the login route remains available without advertising unavailable account functionality.

Result summaries precede offer cards; ranking is rendered only from returned comparison data. Evidence remains available per field and through an optional disclosure. Copy summaries retain simulation provenance, returned ranks, option identity, answer status and exclusions. Prices, part labels and answer summaries require traceable shop evidence. Failed clipboard access reveals selectable plain text. Mock shop cards never expose dial links.

Request, tracking, comparison, demo, metrics and login pages load on demand through named lazy exports; the shell provides an accessible loading status. Obsolete form decoration and selectors were removed. Remaining legacy CSS layers stay in place for untouched screens; simple-experience.css is the final layer for the current task UI.

## Visual direction v2

The visual direction uses a short task-focused introduction, one local Arabic font and restrained shared surfaces. LandingPage has one synthetic offer and native evidence disclosure; old section anchors remain compatible. landing-page.css now exclusively styles this new composition; obsolete marketing selectors were removed from the old light/task layers. The final shared product block in simple-experience.css owns shell, button, form and result-surface presentation. Noto Sans Arabic WOFF2 subsets are hosted under public/fonts with their OFL license; no external font request is required. Tokens separate primitive slate colors from compatibility aliases to avoid self-referential secondary-text values.
