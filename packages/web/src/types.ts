// Wire types mirroring @demist/core and the server API.

export type Schema = Record<string, unknown>;

export interface OperationSummary {
  id: string;
  method: string;
  path: string;
  summary?: string;
  tags: string[];
  deprecated: boolean;
  hasBody: boolean;
}

export interface SecurityScheme {
  type: string;
  description?: string;
  name?: string;
  in?: string;
  scheme?: string;
  flows?: Record<string, { authorizationUrl?: string; tokenUrl?: string; scopes?: Record<string, string> }>;
}

export interface ApiIndex {
  info: { title: string; version: string; description?: string };
  servers: string[];
  operations: OperationSummary[];
  securitySchemes: Record<string, SecurityScheme>;
  schemaCount: number;
  warnings: string[];
}

export interface OpChange {
  method: string;
  path: string;
  summary?: string;
  notes: string[];
}

export interface SpecDiff {
  oldVersion: string;
  newVersion: string;
  added: OperationSummary[];
  removed: OperationSummary[];
  changed: OpChange[];
  schemesAdded: string[];
  schemesRemoved: string[];
  serversChanged?: { old: string[]; new: string[] };
  identical: boolean;
}

export interface ParameterDetail {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema: Schema;
}

export interface OperationDetail extends OperationSummary {
  description?: string;
  parameters: ParameterDetail[];
  body?: { required: boolean; variants: { contentType: string; schema: Schema }[] };
  responses: { status: string; description?: string; contentTypes: string[] }[];
  security: Record<string, string[]>[];
}

export interface AuthProfile {
  scheme: string;
  secret?: string;
  username?: string;
  mode?: 'token' | 'client_credentials' | 'authorization_code';
  clientId?: string;
  scopes?: string[];
}

export interface SavedRequest {
  id: string;
  name: string;
  apiId: string;
  opId: string;
  params?: {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    header?: Record<string, unknown>;
  };
  contentType?: string;
  body?: unknown;
}

export interface WorkspaceApi {
  id: string;
  name: string;
  spec: { url?: string };
  server?: string;
  auth?: AuthProfile;
}

export interface ExchangeRequest {
  method: string;
  url: string;
  raw: string;
}

export interface ExchangeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timeMs: number;
  truncated: boolean;
  bodyText: string;
  raw: string;
}

export interface ExecutePayload {
  apiId: string;
  opId: string;
  params?: {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    header?: Record<string, unknown>;
  };
  contentType?: string;
  body?: unknown;
  baseUrl?: string;
  dryRun?: boolean;
}

export interface UpdateStatus {
  current: string;
  installMode: 'docker' | 'git' | 'package';
  enabled: boolean;
  updateAvailable: boolean;
  latest?: string;
  notes?: string;
  url?: string;
  checkedAt?: number;
  lastError?: string;
}

export interface ExecuteResult {
  request: ExchangeRequest;
  response?: ExchangeResponse;
  error?: string;
  /** Dry-run only: unresolved {{var/secret}} references. */
  missing?: string[];
}
