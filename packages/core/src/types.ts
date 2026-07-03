/** JSON Schema-ish object. We stay loose on purpose: real-world specs are messy. */
export type Schema = Record<string, unknown>;

export interface ApiInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: Record<string, string>;
}

export interface SecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | string;
  description?: string;
  /** apiKey: parameter name */
  name?: string;
  /** apiKey: 'header' | 'query' | 'cookie' */
  in?: string;
  /** http: 'bearer' | 'basic' | ... */
  scheme?: string;
  /** oauth2: flow name (clientCredentials, authorizationCode, ...) -> details */
  flows?: Record<string, OAuthFlow>;
}

/** One entry of an OpenAPI security requirement: schemeKey -> scopes. */
export type SecurityRequirement = Record<string, string[]>;

export interface OperationSummary {
  /** Stable id: operationId when present, else "METHOD path". */
  id: string;
  method: string;
  path: string;
  summary?: string;
  tags: string[];
  deprecated: boolean;
  hasBody: boolean;
}

export interface ApiIndex {
  info: ApiInfo;
  servers: string[];
  operations: OperationSummary[];
  securitySchemes: Record<string, SecurityScheme>;
  /** Number of named schemas in components.schemas. */
  schemaCount: number;
  /** Non-fatal problems found while ingesting the spec. */
  warnings: string[];
}

export interface ParameterDetail {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | string;
  required: boolean;
  description?: string;
  schema: Schema;
}

export interface BodyVariant {
  contentType: string;
  schema: Schema;
}

export interface ResponseSummary {
  status: string;
  description?: string;
  contentTypes: string[];
}

export interface OperationDetail extends OperationSummary {
  description?: string;
  parameters: ParameterDetail[];
  body?: { required: boolean; variants: BodyVariant[] };
  responses: ResponseSummary[];
  /** Effective security requirements (operation-level, falling back to document-level). */
  security: SecurityRequirement[];
}

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecError';
  }
}

/**
 * Render an error including its `cause` chain. Node's fetch (undici) reports
 * bare "fetch failed" and hides the useful part (ENOTFOUND, ETIMEDOUT, TLS…)
 * in error.cause — surfacing it is the difference between a debuggable message
 * and a shrug.
 */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  let cause: unknown = (e as { cause?: unknown }).cause;
  let depth = 0;
  while (cause !== undefined && cause !== null && depth++ < 4) {
    parts.push(cause instanceof Error ? cause.message : String(cause));
    cause = (cause as { cause?: unknown }).cause;
  }
  return [...new Set(parts)].join(' — ');
}
