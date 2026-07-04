#!/usr/bin/env node
// demist: spec-driven multi-API workbench. The server bundle starts listening
// on import and serves the UI from dist/web.
await import('../dist/server.mjs');
