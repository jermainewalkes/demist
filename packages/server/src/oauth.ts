import { describeError } from '@demist/core';

/**
 * OAuth2 client-credentials: fetch and cache access tokens per API.
 * Credentials go in the form body (the most widely accepted variant);
 * tokens are cached until shortly before expiry.
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}

const EXPIRY_SKEW_MS = 30_000;
const DEFAULT_TTL_MS = 5 * 60_000; // when the provider omits expires_in

export class TokenManager {
  private cache = new Map<string, CachedToken>();

  async getToken(
    cacheKey: string,
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    scopes: string[] = [],
  ): Promise<string> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    if (scopes.length > 0) form.set('scope', scopes.join(' '));

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new Error(`Token endpoint unreachable (${tokenUrl}): ${describeError(e)}`);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Token endpoint returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    let data: { access_token?: string; expires_in?: number };
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
    this.cache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + ttlMs - EXPIRY_SKEW_MS,
    });
    return data.access_token;
  }

  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }
}
