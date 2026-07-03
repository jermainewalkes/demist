import type { NormalizedSpec } from './normalize.js';
import { getOperationDetail } from './operation.js';
import type { OperationDetail, OperationSummary } from './types.js';

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

/**
 * Compare two normalized specs (typically: the cached workspace copy vs a fresh
 * fetch of the same URL). Operations match by "METHOD path"; matched pairs are
 * compared on their *resolved* details so $ref-only refactors don't produce noise.
 */
export function diffSpecs(oldSpec: NormalizedSpec, newSpec: NormalizedSpec): SpecDiff {
  const oldOps = new Map(oldSpec.index.operations.map((o) => [`${o.method} ${o.path}`, o]));
  const newOps = new Map(newSpec.index.operations.map((o) => [`${o.method} ${o.path}`, o]));

  const added = [...newOps.entries()].filter(([k]) => !oldOps.has(k)).map(([, o]) => o);
  const removed = [...oldOps.entries()].filter(([k]) => !newOps.has(k)).map(([, o]) => o);

  const changed: OpChange[] = [];
  for (const [key, oldOp] of oldOps) {
    const newOp = newOps.get(key);
    if (!newOp) continue;
    const oldDetail = getOperationDetail(oldSpec.doc, oldOp);
    const newDetail = getOperationDetail(newSpec.doc, newOp);
    const notes = compareDetails(oldDetail, newDetail);
    if (notes.length > 0) {
      changed.push({ method: newOp.method, path: newOp.path, summary: newOp.summary, notes });
    }
  }

  const oldSchemes = Object.keys(oldSpec.index.securitySchemes);
  const newSchemes = Object.keys(newSpec.index.securitySchemes);
  const schemesAdded = newSchemes.filter((s) => !oldSchemes.includes(s));
  const schemesRemoved = oldSchemes.filter((s) => !newSchemes.includes(s));

  const serversChanged =
    JSON.stringify(oldSpec.index.servers) !== JSON.stringify(newSpec.index.servers)
      ? { old: oldSpec.index.servers, new: newSpec.index.servers }
      : undefined;

  return {
    oldVersion: oldSpec.index.info.version,
    newVersion: newSpec.index.info.version,
    added,
    removed,
    changed,
    schemesAdded,
    schemesRemoved,
    serversChanged,
    identical:
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      schemesAdded.length === 0 &&
      schemesRemoved.length === 0 &&
      serversChanged === undefined,
  };
}

function compareDetails(a: OperationDetail, b: OperationDetail): string[] {
  const notes: string[] = [];

  if (a.deprecated !== b.deprecated) {
    notes.push(b.deprecated ? 'now deprecated' : 'no longer deprecated');
  }
  if ((a.summary ?? '') !== (b.summary ?? '')) notes.push('summary changed');

  const aParams = new Map(a.parameters.map((p) => [`${p.in}:${p.name}`, p]));
  const bParams = new Map(b.parameters.map((p) => [`${p.in}:${p.name}`, p]));
  for (const [key, p] of bParams) {
    if (!aParams.has(key)) notes.push(`parameter added: ${p.name} (${p.in})`);
  }
  for (const [key, p] of aParams) {
    if (!bParams.has(key)) notes.push(`parameter removed: ${p.name} (${p.in})`);
  }
  for (const [key, oldP] of aParams) {
    const newP = bParams.get(key);
    if (!newP) continue;
    if (oldP.required !== newP.required) {
      notes.push(`parameter ${newP.name} is ${newP.required ? 'now required' : 'now optional'}`);
    } else if (schemaJson(oldP.schema) !== schemaJson(newP.schema)) {
      notes.push(`parameter ${newP.name}: schema changed`);
    }
  }

  const aTypes = (a.body?.variants ?? []).map((v) => v.contentType);
  const bTypes = (b.body?.variants ?? []).map((v) => v.contentType);
  for (const t of bTypes) if (!aTypes.includes(t)) notes.push(`request body added: ${t}`);
  for (const t of aTypes) if (!bTypes.includes(t)) notes.push(`request body removed: ${t}`);
  for (const t of aTypes) {
    if (!bTypes.includes(t)) continue;
    const oldV = a.body!.variants.find((v) => v.contentType === t)!;
    const newV = b.body!.variants.find((v) => v.contentType === t)!;
    if (schemaJson(oldV.schema) !== schemaJson(newV.schema)) {
      notes.push(`request body schema changed (${t})`);
    }
  }

  const aStatuses = a.responses.map((r) => r.status);
  const bStatuses = b.responses.map((r) => r.status);
  for (const s of bStatuses) if (!aStatuses.includes(s)) notes.push(`response added: ${s}`);
  for (const s of aStatuses) if (!bStatuses.includes(s)) notes.push(`response removed: ${s}`);

  if (stableJson(a.security) !== stableJson(b.security)) notes.push('security requirements changed');

  return notes;
}

/**
 * Schemas are compared with `title` stripped: the resolver injects titles from
 * $ref names, so an inline-schema -> $ref refactor must not read as a change.
 */
function schemaJson(schema: unknown): string {
  return stableJson(stripTitles(schema));
}

function stripTitles(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTitles);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'title')
        .map(([k, v]) => [k, stripTitles(v)]),
    );
  }
  return value;
}

/** JSON.stringify with sorted object keys, so key order never counts as a change. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
