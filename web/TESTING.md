# Frontend Testing

## TDD workflow

1. Define the expected user-visible behavior.
2. Write a focused failing test.
3. Implement the minimum code needed.
4. Make the test pass.
5. Refactor while keeping the suite green.

Tests should describe behavior and accessible output, not implementation details.

## Test layers

### Unit tests

- Pure formatting and bidirectional-text helpers.
- Runtime contract validation.
- Task event reducer transitions.
- Duplicate, replayed, unknown, and out-of-order event behavior.
- Presentation rules for comparison statuses without reimplementing backend ranking.

### Component and integration tests

- Forms use visible labels, preserve input after errors, and focus invalid fields.
- Loading, empty, disconnected, partial, failed, and success states remain understandable without color.
- Evidence opens from the correct field and identifies the shop transcript turn.
- Arabic copy, `dir`, `lang`, mixed-script isolation, keyboard behavior, and focus restoration.
- The mock transport satisfies the interface; a future real transport must satisfy the same interface.

### End-to-end tests

- Request requiring no clarification.
- Request requiring missing-field answers.
- Three comparable quotes.
- Partial results with one failed call.
- Cannot-compare result.
- Evidence inspection.
- SSE interruption, snapshot recovery, reconnection, and duplicate replay.
- Desktop and mobile Arabic RTL layouts.

## Accessibility

Use semantic queries in React Testing Library. Add automated accessibility checks when user-facing feature work begins, but keep keyboard, screen-reader, zoom/reflow, focus, contrast, and real-device review in the manual acceptance checklist because automation is incomplete.

## Commands

```bash
npm test
npm run test:watch
npm run test:e2e
npm run lint
npm run build
```

PR 3 adds component/integration coverage for evidence-backed quote fields, transcript focus/close behavior, comparison explanations, and the cannot-compare fixture, plus Playwright coverage for evidence inspection and Arabic RTL comparison states at desktop and mobile sizes. PR 5 adds pure derivation tests for the simulated metric source records, component and route coverage for the fixture-only metrics dashboard and repeatable demo route, route-change focus regression coverage, and Playwright coverage for the complete demo journey, scenario replay, missing-input flow, provenance labels, responsive navigation, and focus at 320/375/768/1024/1280/1440 pixels.

## UX implementation validation — 6 November 2026

139 unit/component tests pass, covering the two input paths, field focus, preserved drafts, product and Quick Call continuity through demo changes, evidence-safe copy summaries, option identity and clipboard fallback. The 48 Playwright cases cover desktop/mobile journeys, empty/missing-input/partial/cannot-compare states, selection/confirmation, failures, evidence dialogs, both themes and responsive layouts. Reflow checks include 320–2560px and 200% text. Visual review includes populated results rather than only empty forms. Light landing copy uses a plain surface; action text has a minimum readable size.

Lint and production build pass. The initial minified JavaScript entry is approximately 462.5kB (141.4kB gzip); remaining page modules load on demand. No production calls, backend integration, physical-device review or actual screen-reader session is claimed.

## Visual redesign v2 validation — 6 November 2026

141 unit/component tests and all 48 Playwright cases pass, including the one simulated landing offer, native evidence disclosure, Arabic brand label, locally loaded font, both themes, landing/request/result layouts and 200% text. Lint and production build pass. Manual browser checks covered 320/375/768/1024/1280/1440/1920/2560px, populated comparison results and request details. The selected landing text roles measured at least 5.14:1 in dark mode and 4.54:1 in light mode after theme transitions settled; this is a scoped contrast check, not a full WCAG audit. Keyboard skip-to-main and evidence disclosure passed; the old about route still reaches its landing section. No external font requests occurred.

The primary JavaScript entry is about 456.2kB (140.3kB gzip) and CSS 164.3kB before compression. Two licensed local font subsets add about 197kB and can be cached; total first-load savings are not claimed. No physical-device or actual screen-reader session was performed.
