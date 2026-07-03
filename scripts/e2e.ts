/**
 * End-to-end proof of the core promise: the raw HTTP transcript demist shows
 * is exactly what goes over the wire — and secrets never leak to the client.
 *
 * A local echo server plays "the third-party API" (and serves its own OpenAPI
 * spec). A real demist server is spawned as a child process. We drive demist
 * purely through its HTTP API, then compare what the echo server *received*
 * against what the transcript *claimed*.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = 'echo-key-8f2a1d-SECRET';
const DEMIST_PORT = 4455;

interface Captured {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function echoSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: { title: 'Echo API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/anything/{thing}': {
        post: {
          operationId: 'echoThing',
          parameters: [
            { name: 'thing', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { note: { type: 'string' }, count: { type: 'integer' } },
                },
              },
            },
          },
          responses: { '200': { description: 'Echo' } },
          security: [{ echo_key: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        echo_key: { type: 'apiKey', name: 'X-Echo-Key', in: 'header' },
      },
    },
  };
}

async function startEcho(): Promise<{ server: Server; base: string; captured: Captured[] }> {
  const captured: Captured[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.url === '/openapi.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(echoSpec(base)));
        return;
      }
      captured.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ echoed: true, sawKey: req.headers['x-echo-key'] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, base, captured };
}

async function startDemist(root: string): Promise<ChildProcess> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn('npx', ['tsx', 'packages/server/src/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DEMIST_DIR: root,
      DEMIST_PORT: String(DEMIST_PORT),
      DEMIST_VAULT_KEY: 'e2e-master-key',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEMIST_PORT}/api/health`);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill();
  throw new Error('demist server did not come up');
}

async function demist<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${DEMIST_PORT}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const root = mkdtempSync(join(tmpdir(), 'demist-e2e-'));
const { server: echo, base: echoBase, captured } = await startEcho();
let child: ChildProcess | undefined;

try {
  child = await startDemist(root);
  console.log('e2e: demist and echo servers up');

  // 1. Ingest the echo API's spec by URL — the generic path, no special-casing.
  const added = await demist<{ id: string; index: { operations: { id: string }[] } }>(
    '/api/apis',
    { method: 'POST', body: JSON.stringify({ url: `${echoBase}/openapi.json` }) },
  );
  check('spec ingested by URL', added.index.operations.some((o) => o.id === 'echoThing'));

  // 2. Store the secret and wire up the auth profile the spec declares.
  await demist(`/api/secrets/echo_key_secret`, {
    method: 'PUT',
    body: JSON.stringify({ value: SECRET }),
  });
  await demist(`/api/apis/${added.id}/config`, {
    method: 'PUT',
    body: JSON.stringify({ auth: { scheme: 'echo_key', secret: 'echo_key_secret' } }),
  });

  const payload = {
    apiId: added.id,
    opId: 'echoThing',
    params: { path: { thing: 'demo thing' }, query: { verbose: true } },
    contentType: 'application/json',
    body: { note: 'hello', count: 3 },
  };

  // 3. Dry run: the preview transcript must be complete and masked.
  const dry = await demist<{ request: { raw: string } }>('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ ...payload, dryRun: true }),
  });
  check('preview shows method+path', dry.request.raw.includes('POST /anything/demo%20thing?verbose=true HTTP/1.1'));
  check('preview shows auth header, masked', dry.request.raw.includes('x-echo-key: ••••••••'));
  check('preview leaks no secret', !JSON.stringify(dry).includes(SECRET));
  check('nothing hit the wire on dry run', captured.length === 0);

  // 4. Real execution.
  const real = await demist<{
    request: { raw: string };
    response: { status: number; bodyText: string; raw: string };
  }>('/api/execute', { method: 'POST', body: JSON.stringify(payload) });

  check('response is 200', real.response.status === 200);

  // 5. The heart of it: what the echo server RECEIVED == what the transcript CLAIMED.
  const hit = captured[0];
  check('one request hit the echo server', captured.length === 1);
  check('path substituted + encoded', hit.url === '/anything/demo%20thing?verbose=true');
  check('auth header actually sent', hit.headers['x-echo-key'] === SECRET);
  check('content-type sent', hit.headers['content-type'] === 'application/json');
  check('body sent as claimed', JSON.parse(hit.body).note === 'hello' && JSON.parse(hit.body).count === 3);

  // 6. Secrets must be masked everywhere client-facing — including the response,
  //    since the echo body contains the key the server saw.
  check('secret masked in entire execute payload', !JSON.stringify(real).includes(SECRET));
  check('response body still delivered (masked)', real.response.bodyText.includes('"echoed":true'));

  // 7. Workspace YAML holds config but never secrets.
  const { readFileSync } = await import('node:fs');
  const ws = readFileSync(join(root, 'demist.workspace.yaml'), 'utf8');
  check('workspace records auth profile', ws.includes('echo_key'));
  check('workspace contains no secret', !ws.includes(SECRET));
  const vaultRaw = readFileSync(join(root, '.demist', 'vault.json'), 'utf8');
  check('vault file contains no plaintext secret', !vaultRaw.includes(SECRET));
} finally {
  child?.kill();
  echo.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\ne2e: all checks passed' : `\ne2e: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
