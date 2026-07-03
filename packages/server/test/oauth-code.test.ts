import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthCodeManager, sha256base64url, type AuthCodeConfig } from '../src/oauth-code.js';
import { Vault } from '../src/vault.js';

const dir = mkdtempSync(join(tmpdir(), 'demist-oauth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface TokenHit {
  form: URLSearchParams;
}

describe('AuthCodeManager', () => {
  let server: Server;
  const tokenHits: TokenHit[] = [];
  let issueCounter = 0;
  let expiresIn = 3600;

  const baseP = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        tokenHits.push({ form });
        issueCounter++;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: `at-${issueCounter}`,
            refresh_token: `rt-${issueCounter}`,
            expires_in: expiresIn,
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    );
  });
  afterAll(() => server.close());

  async function config(): Promise<AuthCodeConfig> {
    return {
      apiId: 'svc',
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: `${await baseP}/token`,
      clientId: 'demist-app',
      clientSecret: 'shh',
      scopes: ['read', 'write'],
    };
  }

  it('builds a PKCE authorization URL and exchanges the callback code', async () => {
    const vault = new Vault(join(dir, 'v1.json'), 'master');
    const mgr = new AuthCodeManager(vault, 'http://127.0.0.1:4400/api/oauth/callback');
    const cfg = await config();

    const url = new URL(mgr.start(cfg));
    expect(url.origin + url.pathname).toBe('https://idp.example/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('demist-app');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('read write');
    const state = url.searchParams.get('state')!;
    const challenge = url.searchParams.get('code_challenge')!;

    expect(mgr.status('svc').authorized).toBe(false);

    const apiId = await mgr.handleCallback(state, 'the-code', () => cfg);
    expect(apiId).toBe('svc');

    // The exchange must carry the code, PKCE verifier matching the challenge, and credentials.
    const exchange = tokenHits[tokenHits.length - 1].form;
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code')).toBe('the-code');
    expect(exchange.get('client_secret')).toBe('shh');
    expect(sha256base64url(exchange.get('code_verifier')!)).toBe(challenge);

    expect(mgr.status('svc')).toMatchObject({ authorized: true, hasRefresh: true });
    expect(await mgr.getAccessToken(cfg)).toBe('at-1');
    // Token set is in the vault, encrypted — not the workspace, not plaintext.
    expect(vault.list()).toContain('oauth.svc.tokens');
  });

  it('rejects unknown state', async () => {
    const vault = new Vault(join(dir, 'v2.json'), 'master');
    const mgr = new AuthCodeManager(vault, 'http://127.0.0.1:4400/api/oauth/callback');
    await expect(mgr.handleCallback('bogus', 'code', () => {
      throw new Error('should not be called');
    })).rejects.toThrow(/unknown or expired/i);
  });

  it('refreshes expired tokens transparently and keeps the refresh token usable', async () => {
    const vault = new Vault(join(dir, 'v3.json'), 'master');
    const mgr = new AuthCodeManager(vault, 'http://127.0.0.1:4400/api/oauth/callback');
    const cfg = await config();

    expiresIn = 1; // with the 30s skew, this token is born expired
    const url = new URL(mgr.start(cfg));
    await mgr.handleCallback(url.searchParams.get('state')!, 'c', () => cfg);
    const bornExpired = `at-${issueCounter}`;

    expiresIn = 3600;
    const refreshed = await mgr.getAccessToken(cfg);
    expect(refreshed).not.toBe(bornExpired);
    const refreshHit = tokenHits[tokenHits.length - 1].form;
    expect(refreshHit.get('grant_type')).toBe('refresh_token');
    expect(refreshHit.get('refresh_token')).toBe(`rt-${issueCounter - 1}`);

    // Now valid: no further token calls on the next use.
    const hitsBefore = tokenHits.length;
    expect(await mgr.getAccessToken(cfg)).toBe(refreshed);
    expect(tokenHits.length).toBe(hitsBefore);
  });

  it('refuses to start without a vault', () => {
    const vault = new Vault(join(dir, 'v4.json'), undefined);
    const mgr = new AuthCodeManager(vault, 'http://127.0.0.1:4400/api/oauth/callback');
    expect(() =>
      mgr.start({
        apiId: 'x',
        authorizationUrl: 'https://idp.example/a',
        tokenUrl: 'https://idp.example/t',
        clientId: 'c',
        scopes: [],
      }),
    ).toThrow(/vault is disabled/i);
  });
});
