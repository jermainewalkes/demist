# Contributing to Demist

Thanks for your interest! Demist aims to stay small, generic, and honest: everything is derived
from the OpenAPI spec (never hand-tuned per API), and the raw HTTP is never hidden.

## Development setup

```sh
npm install
npm run dev        # server on :4400 + Vite UI on :5173 (proxies /api)
```

Set `DEMIST_VAULT_KEY='some passphrase'` in the environment if you want to exercise secrets.

## Project layout

```
packages/core     spec engine: parse/normalize/diff any Swagger 2.0 / OpenAPI 3.x document
packages/server   Fastify: ingestion, request proxy + transcripts, vault, workspace, OAuth2
packages/web      React + Vite UI (forms generated with react-jsonschema-form)
packages/demist   the publishable package (esbuild bundle + web dist + bin)
scripts/e2e.ts    offline end-to-end suite (local echo server plays the third-party API)
```

## Testing

```sh
npm test           # unit tests (vitest) in core and server
npm run e2e        # end-to-end: proves transcript == wire, masking, OAuth2, diffing
npm run typecheck
```

The core engine is tested against a fixture corpus in `packages/core/test/fixtures/` —
real specs, a Swagger 2.0 spec, a circular-ref spec, and a deliberately broken one. **The best
way to contribute a spec-engine fix is to add the smallest fixture that reproduces the
problem** and assert the expected normalized output.

## Ground rules for changes

- **Generic first.** If a fix only works for one vendor's API, it's the wrong fix — improve the
  engine's tolerance instead.
- **Never hide the HTTP.** Any feature that touches requests must keep the transcript accurate.
- **Secrets stay masked.** Anything client-facing must pass through the masking path; the e2e
  suite asserts no secret bytes reach the browser — keep it green.
- Match the existing code style; TypeScript strict mode is non-negotiable.

## Pull requests

Keep them focused. Include tests. Run the full suite (`npm test && npm run e2e && npm run
typecheck`) before opening.
