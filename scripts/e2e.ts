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
import { createHash } from 'node:crypto';
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
            { name: 'X-Extra', in: 'header', schema: { type: 'string' } },
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

function oauthSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: { title: 'OAuth Echo API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/guarded': {
        get: {
          operationId: 'getGuarded',
          responses: { '200': { description: 'OK' } },
          security: [{ oauth: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: { tokenUrl: `${baseUrl}/token`, scopes: { read: 'Read' } },
          },
        },
      },
    },
  };
}

const OAUTH_TOKEN = 'tok-e2e-ISSUED-SECRET';
const AC_TOKEN = 'ac-at-1-SECRET';
const AC_CODE = 'CODE-42';

function authCodeSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: { title: 'AuthCode Echo API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/guarded-ac': {
        get: {
          operationId: 'getGuardedAc',
          responses: { '200': { description: 'OK' } },
          security: [{ ac: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        ac: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: `${baseUrl}/authorize`,
              tokenUrl: `${baseUrl}/token`,
              scopes: { read: 'Read' },
            },
          },
        },
      },
    },
  };
}

function diffSpec(baseUrl: string, version: 'a' | 'b') {
  const paths: Record<string, unknown> = {
    '/widgets': {
      get: { operationId: 'listWidgets', responses: { '200': { description: 'OK' } } },
    },
  };
  if (version === 'b') {
    (paths['/widgets'] as Record<string, unknown>)['post'] = {
      operationId: 'createWidget',
      responses: { '201': { description: 'Created' } },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Diffable Echo API', version: version === 'a' ? '1.0.0' : '2.0.0' },
    servers: [{ url: baseUrl }],
    paths,
  };
}

async function startEcho(): Promise<{
  server: Server;
  base: string;
  captured: Captured[];
  tokenRequests: string[];
  acTokenRequests: string[];
  setDiffVersion: (v: 'a' | 'b') => void;
}> {
  const captured: Captured[] = [];
  const tokenRequests: string[] = [];
  const acTokenRequests: string[] = [];
  let pkceChallenge: string | undefined;
  let diffVersion: 'a' | 'b' = 'a';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/openapi.json') {
        res.end(JSON.stringify(echoSpec(base)));
        return;
      }
      if (req.url === '/oauth-spec.json') {
        res.end(JSON.stringify(oauthSpec(base)));
        return;
      }
      if (req.url === '/authcode-spec.json') {
        res.end(JSON.stringify(authCodeSpec(base)));
        return;
      }
      if (req.url === '/diff-spec.json') {
        res.end(JSON.stringify(diffSpec(base, diffVersion)));
        return;
      }
      if (req.url === '/releases/latest') {
        res.setHeader('etag', '"rel-etag"');
        res.end(
          JSON.stringify({
            tag_name: 'v9.9.9',
            body: 'e2e release notes',
            html_url: 'https://example.com/releases/v9.9.9',
          }),
        );
        return;
      }
      if (req.url?.startsWith('/authorize')) {
        // "Log in" instantly: remember the PKCE challenge, bounce back with a code.
        const q = new URL(req.url, base).searchParams;
        pkceChallenge = q.get('code_challenge') ?? undefined;
        res.statusCode = 302;
        res.setHeader('location', `${q.get('redirect_uri')}?code=${AC_CODE}&state=${q.get('state')}`);
        res.end();
        return;
      }
      if (req.url === '/token') {
        const form = new URLSearchParams(body);
        const grant = form.get('grant_type');
        if (grant === 'authorization_code') {
          acTokenRequests.push(body);
          const verifierOk =
            form.get('code') === AC_CODE &&
            pkceChallenge !== undefined &&
            createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') ===
              pkceChallenge;
          if (!verifierOk) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'invalid_grant (PKCE or code mismatch)' }));
            return;
          }
          res.end(
            JSON.stringify({ access_token: AC_TOKEN, refresh_token: 'ac-rt-SECRET', expires_in: 3600 }),
          );
          return;
        }
        if (grant === 'refresh_token') {
          acTokenRequests.push(body);
          res.end(JSON.stringify({ access_token: 'ac-at-2-SECRET', expires_in: 3600 }));
          return;
        }
        tokenRequests.push(body);
        res.end(JSON.stringify({ access_token: OAUTH_TOKEN, expires_in: 3600 }));
        return;
      }
      captured.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      res.end(
        JSON.stringify({
          echoed: true,
          sawKey: req.headers['x-echo-key'],
          sawAuth: req.headers.authorization,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    server,
    base,
    captured,
    tokenRequests,
    acTokenRequests,
    setDiffVersion: (v) => {
      diffVersion = v;
    },
  };
}

async function startDemist(root: string, updateRepoBase: string): Promise<ChildProcess> {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn('npx', ['tsx', 'packages/server/src/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DEMIST_DIR: root,
      DEMIST_PORT: String(DEMIST_PORT),
      DEMIST_VAULT_KEY: 'e2e-master-key',
      DEMIST_UPDATE_REPO: updateRepoBase,
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
    ...init,
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

const root = mkdtempSync(join(tmpdir(), 'demist-e2e-'));
const {
  server: echo,
  base: echoBase,
  captured,
  tokenRequests,
  acTokenRequests,
  setDiffVersion,
} = await startEcho();
let child: ChildProcess | undefined;

try {
  child = await startDemist(root, echoBase);
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

  // ---- M2: variables + secret refs -------------------------------------
  console.log('\ne2e: M2 — variables, secret refs, saved requests, oauth2');
  await demist('/api/variables/thing_name', {
    method: 'PUT',
    body: JSON.stringify({ value: 'from-variable' }),
  });
  const varRun = await demist<{ request: { raw: string }; response: { status: number } }>(
    '/api/execute',
    {
      method: 'POST',
      body: JSON.stringify({
        apiId: added.id,
        opId: 'echoThing',
        params: {
          path: { thing: '{{var.thing_name}}' },
          header: { 'X-Extra': '{{secret.echo_key_secret}}' },
        },
        contentType: 'application/json',
        body: { note: 'var run' },
      }),
    },
  );
  const varHit = captured[captured.length - 1];
  check('variable substituted into path', varHit.url.startsWith('/anything/from-variable'));
  check('secret ref resolved on the wire', varHit.headers['x-extra'] === SECRET);
  check('secret ref masked in transcript', !JSON.stringify(varRun).includes(SECRET));

  const missingRun = await fetch(`http://127.0.0.1:${DEMIST_PORT}/api/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiId: added.id,
      opId: 'echoThing',
      params: { path: { thing: '{{var.does_not_exist}}' } },
    }),
  });
  check('unresolved reference rejected with 400', missingRun.status === 400);

  // ---- M2: saved requests ----------------------------------------------
  const saved = await demist<{ id: string }>('/api/requests', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Echo the variable',
      apiId: added.id,
      opId: 'echoThing',
      params: { path: { thing: '{{var.thing_name}}' } },
      contentType: 'application/json',
      body: { note: 'saved' },
    }),
  });
  const wsAfterSave = await demist<{ requests: { id: string }[]; variables: Record<string, string> }>(
    '/api/workspace',
  );
  check('saved request persisted', wsAfterSave.requests.some((r) => r.id === saved.id));
  check('variable persisted in workspace', wsAfterSave.variables.thing_name === 'from-variable');
  const wsYaml = readFileSync(join(root, 'demist.workspace.yaml'), 'utf8');
  check('saved request survives in YAML', wsYaml.includes('Echo the variable'));

  // ---- M2: oauth2 client credentials ------------------------------------
  const oauthAdded = await demist<{ id: string }>('/api/apis', {
    method: 'POST',
    body: JSON.stringify({ url: `${echoBase}/oauth-spec.json` }),
  });
  await demist('/api/secrets/oauth_client_secret', {
    method: 'PUT',
    body: JSON.stringify({ value: 'cc-client-SECRET' }),
  });
  await demist(`/api/apis/${oauthAdded.id}/config`, {
    method: 'PUT',
    body: JSON.stringify({
      auth: {
        scheme: 'oauth',
        secret: 'oauth_client_secret',
        mode: 'client_credentials',
        clientId: 'demist-e2e',
        scopes: ['read'],
      },
    }),
  });

  const oauthPayload = { apiId: oauthAdded.id, opId: 'getGuarded' };
  const dryOauth = await demist<{ request: { raw: string } }>('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ ...oauthPayload, dryRun: true }),
  });
  check('oauth dry run fetches no token', tokenRequests.length === 0);
  check('oauth dry run previews masked bearer', dryOauth.request.raw.includes('authorization: Bearer ••••••••'));

  const oauth1 = await demist<{ response: { status: number } }>('/api/execute', {
    method: 'POST',
    body: JSON.stringify(oauthPayload),
  });
  const oauth2 = await demist<{ response: { status: number } }>('/api/execute', {
    method: 'POST',
    body: JSON.stringify(oauthPayload),
  });
  const guardedHits = captured.filter((c) => c.url === '/guarded');
  check('both oauth calls succeeded', oauth1.response.status === 200 && oauth2.response.status === 200);
  check('bearer token actually sent', guardedHits.every((h) => h.headers.authorization === `Bearer ${OAUTH_TOKEN}`));
  check('token fetched once, cached for the second call', tokenRequests.length === 1);
  const tokenForm = new URLSearchParams(tokenRequests[0] ?? '');
  check(
    'token request carried client credentials + scope',
    tokenForm.get('client_id') === 'demist-e2e' &&
      tokenForm.get('client_secret') === 'cc-client-SECRET' &&
      tokenForm.get('scope') === 'read',
  );
  check(
    'token and client secret masked client-side',
    !JSON.stringify(oauth1).includes(OAUTH_TOKEN) && !JSON.stringify(oauth1).includes('cc-client-SECRET'),
  );

  // ---- M3: oauth2 authorization code (PKCE, browser simulated) ----------
  console.log('\ne2e: M3 — authorization code, spec diffing');
  const demistBase = `http://127.0.0.1:${DEMIST_PORT}`;
  const acAdded = await demist<{ id: string }>('/api/apis', {
    method: 'POST',
    body: JSON.stringify({ url: `${echoBase}/authcode-spec.json` }),
  });
  await demist(`/api/apis/${acAdded.id}/config`, {
    method: 'PUT',
    body: JSON.stringify({
      auth: { scheme: 'ac', mode: 'authorization_code', clientId: 'e2e-ac', scopes: ['read'] },
    }),
  });

  // The browser dance: demist redirect -> provider "login" redirect -> demist callback.
  const startRes = await fetch(`${demistBase}/api/oauth/start?apiId=${acAdded.id}`, {
    redirect: 'manual',
  });
  check('oauth start redirects to the provider', startRes.status === 302);
  const providerUrl = startRes.headers.get('location')!;
  check('provider URL carries PKCE challenge', providerUrl.includes('code_challenge='));
  const providerRes = await fetch(providerUrl, { redirect: 'manual' });
  const callbackUrl = providerRes.headers.get('location')!;
  check('provider bounces back to the demist callback', callbackUrl.startsWith(`${demistBase}/api/oauth/callback`));
  const callbackRes = await fetch(callbackUrl);
  check('callback exchanges the code (PKCE verified by provider)', callbackRes.status === 200);
  check('callback page confirms authorization', (await callbackRes.text()).includes('Authorized'));

  const status = await demist<{ authorized: boolean; hasRefresh: boolean }>(
    `/api/oauth/status?apiId=${acAdded.id}`,
  );
  check('status reports authorized with refresh token', status.authorized && status.hasRefresh);

  const acRun = await demist<{ response: { status: number } }>('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ apiId: acAdded.id, opId: 'getGuardedAc' }),
  });
  const acHit = captured.filter((c) => c.url === '/guarded-ac')[0];
  check('authorized call succeeded', acRun.response.status === 200);
  check('access token actually sent as Bearer', acHit?.headers.authorization === `Bearer ${AC_TOKEN}`);
  check('access token masked client-side', !JSON.stringify(acRun).includes(AC_TOKEN));
  check('exactly one code exchange happened', acTokenRequests.length === 1);

  // ---- M3: spec diffing ---------------------------------------------------
  const diffAdded = await demist<{ id: string; index: { operations: unknown[] } }>('/api/apis', {
    method: 'POST',
    body: JSON.stringify({ url: `${echoBase}/diff-spec.json` }),
  });
  check('diff API starts with one operation', diffAdded.index.operations.length === 1);

  setDiffVersion('b');
  const diff = await demist<{
    identical: boolean;
    oldVersion: string;
    newVersion: string;
    added: { method: string; path: string }[];
  }>(`/api/apis/${diffAdded.id}/diff`);
  check('diff sees the upstream change', !diff.identical && diff.added.length === 1);
  check('diff reports versions', diff.oldVersion === '1.0.0' && diff.newVersion === '2.0.0');
  check('diff names the added operation', diff.added[0].method === 'POST' && diff.added[0].path === '/widgets');

  const refreshed = await demist<{ index: { operations: unknown[] } }>(
    `/api/apis/${diffAdded.id}/refresh`,
    { method: 'POST' },
  );
  check('refresh updates the workspace copy', refreshed.index.operations.length === 2);
  const diffAfter = await demist<{ identical: boolean }>(`/api/apis/${diffAdded.id}/diff`);
  check('post-refresh diff is identical', diffAfter.identical);

  // ---- update check -------------------------------------------------------
  const upd = await demist<{
    updateAvailable: boolean;
    latest?: string;
    notes?: string;
    installMode: string;
    current: string;
  }>('/api/update');
  check('update available against mock releases', upd.updateAvailable && upd.latest === 'v9.9.9');
  check('release notes carried through', upd.notes === 'e2e release notes');
  check('install mode detected as git checkout', upd.installMode === 'git');
  const health = await demist<{ version: string; installMode: string }>('/api/health');
  check('health reports version + install mode', health.version === upd.current && health.installMode === 'git');
} finally {
  child?.kill();
  echo.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\ne2e: all checks passed' : `\ne2e: ${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
