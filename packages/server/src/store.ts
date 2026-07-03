import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchSpec,
  normalizeSpec,
  parseSpecText,
  type NormalizedSpec,
} from '@demist/core';

/**
 * Holds normalized specs: in memory for the session, mirrored to .demist/specs/
 * so a restart doesn't refetch. The workspace YAML only records the spec URL.
 */
export class SpecStore {
  private cache = new Map<string, NormalizedSpec>();

  constructor(private readonly cacheDir: string) {}

  async ingestFromUrl(id: string, url: string): Promise<NormalizedSpec> {
    const raw = await fetchSpec(url);
    return this.ingestRaw(id, raw);
  }

  async ingestFromText(id: string, text: string): Promise<NormalizedSpec> {
    return this.ingestRaw(id, parseSpecText(text));
  }

  private async ingestRaw(id: string, raw: Record<string, unknown>): Promise<NormalizedSpec> {
    const spec = await normalizeSpec(raw);
    this.cache.set(id, spec);
    mkdirSync(this.cacheDir, { recursive: true });
    // Persist the upconverted doc: reloading skips the 2.0 conversion.
    writeFileSync(this.docPath(id), JSON.stringify(spec.doc), 'utf8');
    return spec;
  }

  /** Memory -> disk cache -> refetch from the workspace's spec URL. */
  async get(id: string, specUrl?: string): Promise<NormalizedSpec> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (existsSync(this.docPath(id))) {
      const doc = JSON.parse(readFileSync(this.docPath(id), 'utf8'));
      const spec = await normalizeSpec(doc);
      this.cache.set(id, spec);
      return spec;
    }
    if (specUrl) return this.ingestFromUrl(id, specUrl);
    throw new Error(`No cached spec for "${id}" and no spec URL to refetch from`);
  }

  remove(id: string): void {
    this.cache.delete(id);
    rmSync(this.docPath(id), { force: true });
  }

  private docPath(id: string): string {
    // ids are validated as [a-z0-9-]+ before they reach the store
    return join(this.cacheDir, `${id}.json`);
  }
}
