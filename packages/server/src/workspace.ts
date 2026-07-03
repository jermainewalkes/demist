import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

export interface AuthProfile {
  /** Key of a securityScheme in the API's spec. */
  scheme: string;
  /** Vault entry name holding the secret value (API key, token, password, or client secret). */
  secret?: string;
  /** For HTTP basic auth. */
  username?: string;
  /** For oauth2 schemes: paste-a-token (default), client credentials, or browser authorization-code. */
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
  /** Chosen base URL; falls back to the spec's first server. */
  server?: string;
  auth?: AuthProfile;
}

export interface Workspace {
  version: 1;
  apis: WorkspaceApi[];
  /** Plain (non-secret) values usable as {{var.name}} in any request field. */
  variables: Record<string, string>;
  requests: SavedRequest[];
}

/**
 * The workspace is a plain YAML file, re-read on every access so hand-edits
 * are always respected, and written atomically. Secrets never appear in it.
 */
export class WorkspaceStore {
  constructor(private readonly filePath: string) {}

  read(): Workspace {
    const empty: Workspace = { version: 1, apis: [], variables: {}, requests: [] };
    if (!existsSync(this.filePath)) return empty;
    const doc = yaml.load(readFileSync(this.filePath, 'utf8'));
    if (typeof doc !== 'object' || doc === null) return empty;
    const ws = doc as Partial<Workspace>;
    return {
      version: 1,
      apis: Array.isArray(ws.apis) ? ws.apis : [],
      variables:
        typeof ws.variables === 'object' && ws.variables !== null && !Array.isArray(ws.variables)
          ? (ws.variables as Record<string, string>)
          : {},
      requests: Array.isArray(ws.requests) ? ws.requests : [],
    };
  }

  write(ws: Workspace): void {
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, yaml.dump(ws, { noRefs: true, lineWidth: 100 }), 'utf8');
    renameSync(tmp, this.filePath);
  }

  update(fn: (ws: Workspace) => void): Workspace {
    const ws = this.read();
    fn(ws);
    this.write(ws);
    return ws;
  }
}
