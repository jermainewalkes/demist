import { createServer, type Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { TokenManager } from '../src/oauth.js';
import { substitute } from '../src/template.js';

describe('substitute', () => {
  const ctx = {
    variables: { project: 'demist', host: 'https://gitlab.local' },
    getSecret: (n: string) => (n === 'gl_token' ? 'glpat-SECRET' : undefined),
  };

  it('replaces vars and secrets deep in nested structures', () => {
    const r = substitute(
      {
        base: '{{var.host}}/api/v4',
        query: { search: '{{var.project}}' },
        header: { 'PRIVATE-TOKEN': '{{secret.gl_token}}' },
        body: { items: [{ note: 'about {{var.project}}' }] },
      },
      ctx,
    );
    expect(r.value.base).toBe('https://gitlab.local/api/v4');
    expect(r.value.query.search).toBe('demist');
    expect(r.value.header['PRIVATE-TOKEN']).toBe('glpat-SECRET');
    expect((r.value.body.items[0] as { note: string }).note).toBe('about demist');
    expect(r.maskValues).toEqual(['glpat-SECRET']);
    expect(r.missing).toEqual([]);
  });

  it('reports missing references and leaves them literal', () => {
    const r = substitute({ a: '{{var.nope}}', b: '{{secret.nada}}' }, ctx);
    expect(r.value.a).toBe('{{var.nope}}');
    expect(r.missing.sort()).toEqual(['secret.nada', 'var.nope']);
    expect(r.maskValues).toEqual([]);
  });

  it('reports secrets as missing when the vault is disabled', () => {
    const r = substitute({ a: '{{secret.gl_token}}' }, { variables: {} });
    expect(r.missing).toEqual(['secret.gl_token']);
  });

  it('leaves non-placeholder braces and non-strings alone', () => {
    const r = substitute({ a: '{{something else}}', n: 42, ok: true }, ctx);
    expect(r.value).toEqual({ a: '{{something else}}', n: 42, ok: true });
  });
});

describe('TokenManager', () => {
  let server: Server;
  let issued = 0;
  let lastBody = '';

  const base = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastBody = body;
        issued++;
        res.setHeader('content-type', 'application/json');
        if (req.url === '/token-no-expiry') {
          res.end(JSON.stringify({ access_token: `tok-${issued}` }));
        } else if (req.url === '/token-bad') {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'invalid_client' }));
        } else {
          res.end(JSON.stringify({ access_token: `tok-${issued}`, expires_in: 3600 }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
    });
  });

  afterAll(() => server.close());

  it('fetches, sends client credentials as a form, and caches until expiry', async () => {
    const url = `${await base}/token`;
    const tm = new TokenManager();
    const t1 = await tm.getToken('api1', url, 'my-client', 'my-secret', ['read', 'write']);
    expect(t1).toBe('tok-1');
    const form = new URLSearchParams(lastBody);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('my-client');
    expect(form.get('client_secret')).toBe('my-secret');
    expect(form.get('scope')).toBe('read write');

    // Second call within expiry: cached, no new token issued.
    const t2 = await tm.getToken('api1', url, 'my-client', 'my-secret', ['read', 'write']);
    expect(t2).toBe('tok-1');

    // Different cache key: new token.
    const t3 = await tm.getToken('api2', url, 'my-client', 'my-secret');
    expect(t3).toBe('tok-2');

    tm.invalidate('api1');
    expect(await tm.getToken('api1', url, 'my-client', 'my-secret')).toBe('tok-3');
  });

  it('applies a default TTL when expires_in is absent', async () => {
    const url = `${await base}/token-no-expiry`;
    const tm = new TokenManager();
    const t1 = await tm.getToken('x', url, 'c', 's');
    expect(await tm.getToken('x', url, 'c', 's')).toBe(t1);
  });

  it('surfaces token-endpoint failures clearly', async () => {
    const url = `${await base}/token-bad`;
    const tm = new TokenManager();
    await expect(tm.getToken('y', url, 'c', 'wrong')).rejects.toThrow(/HTTP 401/);
  });
});
