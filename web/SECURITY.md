# Frontend Security

## Environment variables

- Every `VITE_*` value is included in browser-delivered code and must be treated as public.
- Store only public configuration such as the API base URL or transport mode in frontend environment files.
- Never store Twilio, ElevenLabs, Google Places, database, LLM, signing, or service credentials in `/web`.
- Commit `.env.example`, not local `.env` files.

## Untrusted data

- Requests, shop names, transcripts, evidence quotes, URLs, and API/SSE payloads are untrusted.
- Validate payload shape at the transport boundary.
- Render transcripts and evidence as React text content. Do not use `dangerouslySetInnerHTML` or string-built HTML.
- Validate URL protocols before using provider-supplied links. Permit only explicitly required schemes.
- Frontend validation supports usability; the backend remains responsible for authoritative validation, authorization, allowlists, rate limits, webhook verification, and business rules.

## API communication

- Production API and SSE connections must use HTTPS.
- Do not put secrets or sensitive task content in query strings.
- Define credentials/CORS behavior with the backend team before enabling authenticated requests.
- Treat transport disconnection separately from task failure and avoid exposing raw server errors to users.

## Sensitive information

- Do not log user requests, phone numbers, shop-worker names, transcripts, evidence, recordings, or raw provider payloads in the browser console or analytics.
- Do not persist sensitive task data in local storage unless an approved retention and threat model requires it.
- The UI must not display real recordings or identities publicly without consent.
- Fixtures must be synthetic and must not reproduce real call content.

## Dependencies and delivery

- Keep dependencies minimal and review lockfile changes.
- Run dependency audits and CI checks; assess findings instead of applying unreviewed breaking upgrades.
- Keep source maps and error reporting configuration free of sensitive payloads.
- Use a restrictive Content Security Policy at deployment; the hosting/backend owner must configure response headers.

## Responsibility boundary

The frontend can reduce accidental exposure and unsafe rendering. It cannot securely hide browser-delivered values, authenticate itself with a private secret, enforce calling permissions, or replace backend access control.
