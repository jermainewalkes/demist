import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

export interface AuthProfile {
  /** Key of a securityScheme in the API's spec. */
  scheme: string;
  /** Vault entry name holding the secret value (API key, token, or password). */
  secret?: string;
  /** For HTTP basic auth. */
  username?: string;
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
}

/**
 * The workspace is a plain YAML file, re-read on every access so hand-edits
 * are always respected, and written atomically. Secrets never appear in it.
 */
export class WorkspaceStore {
  constructor(private readonly filePath: string) {}

  read(): Workspace {
    if (!existsSync(this.filePath)) return { version: 1, apis: [] };
    const doc = yaml.load(readFileSync(this.filePath, 'utf8'));
    if (typeof doc !== 'object' || doc === null) return { version: 1, apis: [] };
    const ws = doc as Partial<Workspace>;
    return { version: 1, apis: Array.isArray(ws.apis) ? ws.apis : [] };
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
