# Security policy

demist is a local-first tool that proxies HTTP requests and stores API credentials encrypted
at rest (AES-256-GCM). Security reports are very welcome.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email
**[redacted]** with details and, ideally, a reproduction. You should get a
response within a few days.

## Scope notes

- The server binds to `127.0.0.1` by default and is designed for single-user local use.
  Exposing it on a network is not a supported configuration of the open-source edition.
- The proxy will call any URL the local user asks it to — that is its purpose. SSRF-style
  reports against a locally-bound instance are out of scope unless they cross a trust boundary
  (e.g. secrets leaking into client-visible output, vault decryption without the key).
- Reports that secret material reaches the browser, transcripts, logs, or the workspace file
  in any form are always in scope and treated as high severity.
