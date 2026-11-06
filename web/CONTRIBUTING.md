# Contributing to the Frontend

## Setup

Use a supported Node.js LTS release, then run:

```bash
npm install
npm run dev
```

## Naming

- React components: `PascalCase.jsx`.
- Hooks: `useName.js`.
- Utilities, reducers, transports, and schemas: `camelCase.js`.
- Tests live beside the module as `*.test.js` or `*.test.jsx`; Playwright journeys live in `e2e`.
- Prefer named exports.

## Branches and commits

- Use the repository convention `r7/<topic>`, such as `r7/frontend-foundation`.
- Keep each branch and pull request focused on one reviewable topic.
- Write imperative commit subjects that explain the outcome.
- Do not mix formatting, dependency upgrades, or unrelated cleanup into feature work.

## Pull requests

Every PR description includes:

- **What** changed.
- **Why** it changed.
- **How I verified** it, including commands and relevant manual checks.

Call out provisional contract assumptions, accessibility limits, screenshots for visual work, and any dependency additions. Obtain the required backup review before merge.

## Quality checks

Before requesting review:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Also review Arabic copy, RTL layout, keyboard focus, reduced motion, 200% zoom, and the relevant responsive sizes. Never commit secrets, recordings, real transcripts, or personal information.
