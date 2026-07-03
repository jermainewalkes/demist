import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAuth } from '../src/auth.js';
import { buildRequest, renderRequestTranscript, MASK } from '../src/proxy.js';
import { Vault } from '../src/vault.js';
import { WorkspaceStore } from '../src/workspace.js';

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'demist-test-'));
  cleanups.push(dir);
  return dir;
}

describe('Vault', () => {
  it('round-trips secrets encrypted at rest', () => {
    const file = join(tempDir(), 'vault.json');
    const vault = new Vault(file, 'correct horse battery staple');
    vault.set('gh_token', 'ghp_supersecret123');
    expect(vault.get('gh_token')).toBe('ghp_supersecret123');
    expect(vault.list()).toEqual(['gh_token']);

    // Nothing plaintext on disk
    expect(readFileSync(file, 'utf8')).not.toContain('supersecret');

    // A fresh instance with the same key decrypts; entries survive restarts
    const again = new Vault(file, 'correct horse battery staple');
    expect(again.get('gh_token')).toBe('ghp_supersecret123');

    again.delete('gh_token');
    expect(again.list()).toEqual([]);
  });

  it('refuses to decrypt with the wrong key', () => {
    const file = join(tempDir(), 'vault.json');
    new Vault(file, 'right-key').set('s', 'value');
    expect(() => new Vault(file, 'wrong-key').get('s')).toThrow();
  });

  it('is disabled without a master key', () => {
    const vault = new Vault(join(tempDir(), 'vault.json'), undefined);
    expect(vault.enabled).toBe(false);
    expect(() => vault.set('a', 'b')).toThrow(/disabled/i);
  });
});

describe('buildAuth', () => {
  it('apiKey in header / query / cookie', () => {
    expect(
      buildAuth({ type: 'apiKey', name: 'X-Key', in: 'header' }, { scheme: 'k' }, 'v1').headers,
    ).toEqual({ 'X-Key': 'v1' });
    expect(
      buildAuth({ type: 'apiKey', name: 'key', in: 'query' }, { scheme: 'k' }, 'v2').query,
    ).toEqual({ key: 'v2' });
    expect(
      buildAuth({ type: 'apiKey', name: 'sid', in: 'cookie' }, { scheme: 'k' }, 'v3').headers,
    ).toEqual({ cookie: 'sid=v3' });
  });

  it('http bearer and basic', () => {
    expect(buildAuth({ type: 'http', scheme: 'bearer' }, { scheme: 'b' }, 'tok').headers).toEqual({
      authorization: 'Bearer tok',
    });
    const basic = buildAuth(
      { type: 'http', scheme: 'basic' },
      { scheme: 'b', username: 'jermaine' },
      'pw',
    );
    expect(basic.headers.authorization).toBe(
      `Basic ${Buffer.from('jermaine:pw').toString('base64')}`,
    );
    // both the password and its encoding must be maskable
    expect(basic.maskValues).toContain('pw');
    expect(basic.maskValues.length).toBe(2);
  });
});

describe('buildRequest + transcript', () => {
  it('substitutes path params, appends query, sets body', () => {
    const built = buildRequest({
      baseUrl: 'https://api.example.com/v1/',
      method: 'POST',
      path: '/pets/{petId}/toys',
      pathParams: { petId: 'a/b' },
      query: { verbose: true, tag: ['red', 'blue'], empty: '' },
      headers: { 'X-Trace': 'abc' },
      contentType: 'application/json',
      body: { name: 'ball' },
      auth: { headers: { authorization: 'Bearer sekrit' }, query: {}, maskValues: ['sekrit'] },
    });
    expect(built.url).toBe(
      'https://api.example.com/v1/pets/a%2Fb/toys?verbose=true&tag=red&tag=blue',
    );
    expect(built.headers['content-type']).toBe('application/json');
    expect(built.bodyText).toContain('"name": "ball"');

    const raw = renderRequestTranscript(built, true);
    expect(raw).toContain('POST /v1/pets/a%2Fb/toys?verbose=true&tag=red&tag=blue HTTP/1.1');
    expect(raw).toContain('host: api.example.com');
    expect(raw).toContain(`authorization: Bearer ${MASK}`);
    expect(raw).not.toContain('sekrit');

    // unmasked variant (never sent to the browser) keeps the real value
    expect(renderRequestTranscript(built, false)).toContain('Bearer sekrit');
  });

  it('errors on missing path params', () => {
    expect(() =>
      buildRequest({
        baseUrl: 'https://x.example',
        method: 'GET',
        path: '/a/{id}',
        pathParams: {},
        query: {},
        headers: {},
        auth: { headers: {}, query: {}, maskValues: [] },
      }),
    ).toThrow(/missing path parameter/i);
  });

  it('encodes form bodies', () => {
    const built = buildRequest({
      baseUrl: 'https://x.example',
      method: 'POST',
      path: '/login',
      pathParams: {},
      query: {},
      headers: {},
      contentType: 'application/x-www-form-urlencoded',
      body: { user: 'a b', ok: true },
      auth: { headers: {}, query: {}, maskValues: [] },
    });
    expect(built.bodyText).toBe('user=a+b&ok=true');
  });
});

describe('WorkspaceStore', () => {
  it('round-trips YAML and respects hand-edits', () => {
    const file = join(tempDir(), 'demist.workspace.yaml');
    const ws = new WorkspaceStore(file);
    expect(ws.read().apis).toEqual([]);

    ws.update((w) => {
      w.apis.push({ id: 'petstore', name: 'Petstore', spec: { url: 'https://x.example/s.json' } });
    });
    expect(ws.read().apis[0].id).toBe('petstore');
    expect(readFileSync(file, 'utf8')).toContain('petstore');
  });
});
