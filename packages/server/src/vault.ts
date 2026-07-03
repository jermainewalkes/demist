import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface VaultEntry {
  iv: string;
  ct: string;
  tag: string;
}

interface VaultFile {
  version: 1;
  salt: string;
  entries: Record<string, VaultEntry>;
}

/**
 * Encrypted-at-rest secrets store: AES-256-GCM per entry, key derived with scrypt
 * from a master key (DEMIST_VAULT_KEY). Without a master key the vault is disabled
 * rather than falling back to plaintext.
 */
export class Vault {
  private key?: Buffer;
  private salt?: Buffer;

  constructor(
    private readonly filePath: string,
    masterKey: string | undefined,
  ) {
    if (!masterKey) return;
    const file = this.load();
    this.salt = file ? Buffer.from(file.salt, 'hex') : randomBytes(16);
    this.key = scryptSync(masterKey, this.salt, 32);
    if (!file) this.save({ version: 1, salt: this.salt.toString('hex'), entries: {} });
  }

  get enabled(): boolean {
    return this.key !== undefined;
  }

  list(): string[] {
    return Object.keys(this.load()?.entries ?? {}).sort();
  }

  set(name: string, value: string): void {
    const file = this.require();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key!, iv);
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    file.entries[name] = {
      iv: iv.toString('hex'),
      ct: ct.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    };
    this.save(file);
  }

  get(name: string): string | undefined {
    const entry = this.require().entries[name];
    if (!entry) return undefined;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key!,
      Buffer.from(entry.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.ct, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  delete(name: string): void {
    const file = this.require();
    delete file.entries[name];
    this.save(file);
  }

  private require(): VaultFile {
    if (!this.enabled) {
      throw new Error('Vault is disabled: set DEMIST_VAULT_KEY to store secrets');
    }
    return this.load() ?? { version: 1, salt: this.salt!.toString('hex'), entries: {} };
  }

  private load(): VaultFile | undefined {
    if (!existsSync(this.filePath)) return undefined;
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as VaultFile;
  }

  private save(file: VaultFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
  }
}
