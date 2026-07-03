import { createHash, randomBytes } from 'node:crypto';
import { describeError } from '@demist/core';
import type { Vault } from './vault.js';

/**
 * OAuth2 authorization-code flow with PKCE (S256), for a local single-user tool:
 * - /api/oauth/start builds the provider URL (state + code challenge) and redirects;
 * - the provider redirects back to /api/oauth/callback, which exchanges the code;
 * - token sets (access + refresh) live in the vault, never in the workspace file;
 * - expired access tokens are refreshed transparently at execute time.
 */

export interface AuthCodeConfig {
  apiId: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  /** Confidential clients send this at exchange/refresh; PKCE-only clients omit it. */
  clientSecret?: string;
  scopes: string[];
}

interface PendingAuth {
  apiId: string;
  verifier: string;
  createdAt: number;
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;
const EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TTL_MS = 5 * 60_000;

export class AuthCodeManager {
  private pending = new Map<string, PendingAuth>();

  constructor(
    private readonly vault: Vault,
    private readonly redirectUri: string,
  ) {}

  get callbackUrl(): string {
    return this.redirectUri;
  }

  /** Build the provider authorization URL and remember state + PKCE verifier. */
  start(cfg: AuthCodeConfig): string {
    if (!this.vault.enabled) {
      throw new Error('Vault is disabled: set DEMIST_VAULT_KEY — tokens are stored encrypted');
    }
    this.prunePending();
    const state = randomBytes(16).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    this.pending.set(state, { apiId: cfg.apiId, verifier, createdAt: Date.now() });

    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', sha256base64url(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    if (cfg.scopes.length > 0) url.searchParams.set('scope', cfg.scopes.join(' '));
    return url.toString();
  }

  /** Exchange the callback code for tokens. Returns the apiId that was authorized. */
  async handleCallback(
    state: string,
    code: string,
    getConfig: (apiId: string) => AuthCodeConfig,
  ): Promise<string> {
    const pending = this.pending.get(state);
    if (!pending) {
      throw new Error('Unknown or expired authorization state — start the flow again');
    }
    this.pending.delete(state);
    const cfg = getConfig(pending.apiId);
    const tokens = await this.requestToken(cfg, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier,
    });
    this.store(pending.apiId, tokens);
    return pending.apiId;
  }

  status(apiId: string): { authorized: boolean; expiresAt?: number; hasRefresh?: boolean } {
    const set = this.load(apiId);
    if (!set) return { authorized: false };
    return { authorized: true, expiresAt: set.expiresAt, hasRefresh: Boolean(set.refreshToken) };
  }

  /** Valid access token for the API, refreshing if expired. */
  async getAccessToken(cfg: AuthCodeConfig): Promise<string> {
    const set = this.load(cfg.apiId);
    if (!set) {
      throw new Error('Not authorized yet — open auth settings and click "Authorize in browser"');
    }
    if (set.expiresAt > Date.now()) return set.accessToken;
    if (!set.refreshToken) {
      throw new Error('Access token expired and no refresh token was issued — re-authorize');
    }
    const fresh = await this.requestToken(cfg, {
      grant_type: 'refresh_token',
      refresh_token: set.refreshToken,
    });
    // Providers may omit the refresh token on refresh; keep the old one then.
    if (!fresh.refreshToken) fresh.refreshToken = set.refreshToken;
    this.store(cfg.apiId, fresh);
    return fresh.accessToken;
  }

  forget(apiId: string): void {
    if (this.vault.enabled) this.vault.delete(this.vaultKey(apiId));
  }

  private async requestToken(
    cfg: AuthCodeConfig,
    grant: Record<string, string>,
  ): Promise<TokenSet> {
    const form = new URLSearchParams({ ...grant, client_id: cfg.clientId });
    if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret);

    let res: Response;
    try {
      res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new Error(`Token endpoint unreachable (${cfg.tokenUrl}): ${describeError(e)}`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Token endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    let data: { access_token?: string; refresh_token?: string; expires_in?: number };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Token endpoint returned non-JSON: ${text.slice(0, 300)}`);
    }
    if (typeof data.access_token !== 'string') {
      throw new Error('Token endpoint response has no "access_token"');
    }
    const ttlMs =
      typeof data.expires_in === 'number' && data.expires_in > 0
        ? data.expires_in * 1000
        : DEFAULT_TTL_MS;
    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      expiresAt: Date.now() + ttlMs - EXPIRY_SKEW_MS,
    };
  }

  private vaultKey(apiId: string): string {
    return `oauth.${apiId}.tokens`;
  }

  private load(apiId: string): TokenSet | undefined {
    if (!this.vault.enabled) return undefined;
    const raw = this.vault.get(this.vaultKey(apiId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as TokenSet;
    } catch {
      return undefined;
    }
  }

  private store(apiId: string, set: TokenSet): void {
    this.vault.set(this.vaultKey(apiId), JSON.stringify(set));
  }

  private prunePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [state, p] of this.pending) {
      if (p.createdAt < cutoff) this.pending.delete(state);
    }
  }
}

export function sha256base64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}
