import type { SecurityScheme } from '@demist/core';
import type { AuthProfile } from './workspace.js';

export interface AuthMaterial {
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Raw values that must be masked in any transcript shown to a human. */
  maskValues: string[];
}

export const EMPTY_AUTH: AuthMaterial = { headers: {}, query: {}, maskValues: [] };

/**
 * Turn a spec-declared security scheme + the user's auth profile into concrete
 * request material. OAuth2/OIDC are handled as "paste a token" (bearer) in v0.1.
 */
export function buildAuth(
  scheme: SecurityScheme,
  profile: AuthProfile,
  secretValue: string,
): AuthMaterial {
  switch (scheme.type) {
    case 'apiKey': {
      if (!scheme.name) throw new Error(`apiKey scheme "${profile.scheme}" has no parameter name`);
      if (scheme.in === 'query') {
        return { headers: {}, query: { [scheme.name]: secretValue }, maskValues: [secretValue] };
      }
      if (scheme.in === 'cookie') {
        return {
          headers: { cookie: `${scheme.name}=${secretValue}` },
          query: {},
          maskValues: [secretValue],
        };
      }
      return { headers: { [scheme.name]: secretValue }, query: {}, maskValues: [secretValue] };
    }
    case 'http': {
      if ((scheme.scheme ?? 'bearer').toLowerCase() === 'basic') {
        const b64 = Buffer.from(`${profile.username ?? ''}:${secretValue}`).toString('base64');
        return {
          headers: { authorization: `Basic ${b64}` },
          query: {},
          maskValues: [secretValue, b64],
        };
      }
      return {
        headers: { authorization: `Bearer ${secretValue}` },
        query: {},
        maskValues: [secretValue],
      };
    }
    case 'oauth2':
    case 'openIdConnect':
      return {
        headers: { authorization: `Bearer ${secretValue}` },
        query: {},
        maskValues: [secretValue],
      };
    default:
      throw new Error(`Unsupported security scheme type: ${scheme.type}`);
  }
}
