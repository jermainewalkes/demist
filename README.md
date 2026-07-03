# demist

**A spec-driven multi-API workbench.** Point it at any OpenAPI/Swagger spec URL and get a humane
GUI: operations grouped by resource, request forms generated from schemas, auth configured once
per API — with multiple APIs living side by side in one workspace.

The signature feature: **demist always shows you the exact raw HTTP it sends.** Most API tools
hide the plumbing; demist teaches it while you work. Every generated form has a live preview of
the request it will produce, and every call returns a full request/response transcript
(secrets masked).

## Why

A REST API described by an OpenAPI spec is fully machine-readable — its operations, parameters,
schemas, and auth requirements can all be *derived* rather than hand-built. That's the same
insight Infrastructure-as-Code exploits: a Terraform provider is a codified API surface. demist
applies it to a GUI: no hand-tuned per-service integrations, just a generic engine that turns
any spec into a usable console.

## Status

Early but capable — milestones 1–3 are done:

- [x] Generic spec engine: Swagger 2.0 / OpenAPI 3.0 / 3.1, JSON or YAML, by URL or file
- [x] Lazy, cycle-safe `$ref` resolution (large specs like GitHub's ~10 MB one stay fast)
- [x] Request proxy with raw HTTP transcripts and secret masking
- [x] Encrypted secrets vault (AES-256-GCM); secrets never touch the browser or the workspace file
- [x] Auth profiles derived from the spec's `securitySchemes` (apiKey / bearer / basic)
- [x] Schema-generated request forms in the browser
- [x] Workspace variables and vault refs: `{{var.name}}` / `{{secret.name}}` in any field
- [x] Saved requests; response-value extraction into variables (cross-API chaining)
- [x] OAuth2 client credentials (token caching) and authorization code (PKCE, auto-refresh)
- [x] Capability map: an X-ray of everything an API can do, from its spec alone
- [x] Spec diffing: compare your workspace copy against upstream, one-click update
- [ ] Publishing: npx one-command run, GitHub release

## Quick start

```sh
npm install
npm run dev
```

Then open http://localhost:5173, paste a spec URL (e.g. the
[Petstore](https://petstore3.swagger.io/api/v3/openapi.json)), and explore.

The server listens on http://localhost:4400; the Vite dev server proxies `/api` to it.

## The workspace file

Your workspace is a plain, git-friendly YAML file — `demist.workspace.yaml` — in the directory
you run demist from. It records which APIs you've added, which server/base URL each uses, and
which auth profile applies. Hand-edits are respected. Secrets are **never** stored in it: they
live in `.demist/vault.json`, encrypted with AES-256-GCM under a key derived from
`DEMIST_VAULT_KEY` (set it in your environment; without it, secret storage is disabled).

```yaml
version: 1
apis:
  - id: petstore
    name: Swagger Petstore
    spec:
      url: https://petstore3.swagger.io/api/v3/openapi.json
    auth:
      scheme: api_key        # a securityScheme key from the spec
      secret: petstore_key   # the vault entry holding the value
```

## Architecture

```
packages/
  core/     the spec engine — parse, validate, normalize any spec to one internal model
  server/   Fastify: spec ingestion, request proxy + transcripts, vault, workspace persistence
  web/      React + Vite UI; forms generated from JSON Schema (react-jsonschema-form)
```

A small local server exists because a pure browser app can't call arbitrary third-party APIs
(CORS) and shouldn't hold secrets. The UI never sees a secret value — the proxy injects auth
server-side and masks it in transcripts.

## Development

```sh
npm test            # unit tests (fixture corpus of real and broken specs)
npm run e2e         # end-to-end: proves the proxy sends exactly what the transcript claims
npm run typecheck
```

## License

MIT
