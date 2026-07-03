import type { Schema } from './types.js';

/** Resolve a local JSON pointer like "#/components/schemas/Pet" against the document. */
export function resolvePointer(doc: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = doc;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const MAX_DEPTH = 40;

/**
 * Deep-resolve a schema's local $refs into a self-contained JSON Schema, safely:
 * - cycles are cut (replaced by a stub with a note) so the result is always finite;
 * - depth is bounded so pathological specs can't blow the stack;
 * - external refs are left as annotated stubs rather than fetched;
 * - OpenAPI 3.0 `nullable` is rewritten to a JSON Schema type union.
 *
 * This runs per-operation on demand — never over a whole document — which is what
 * keeps very large specs (GitHub's is ~10 MB) fast to browse.
 */
export function resolveSchema(doc: unknown, schema: unknown): Schema {
  return walk(schema, doc, new Set(), 0);
}

function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

function walk(node: unknown, doc: unknown, activeRefs: Set<string>, depth: number): Schema {
  if (typeof node === 'boolean') {
    // JSON Schema allows `true`/`false` as schemas.
    return node ? {} : { not: {} };
  }
  if (typeof node !== 'object' || node === null) return {};
  if (depth > MAX_DEPTH) {
    return { description: '[schema truncated: maximum depth reached]' };
  }

  const obj = node as Record<string, unknown>;

  if (typeof obj.$ref === 'string') {
    const ref = obj.$ref;
    if (!ref.startsWith('#/')) {
      return { description: `[external reference not resolved: ${ref}]` };
    }
    if (activeRefs.has(ref)) {
      return {
        title: refName(ref),
        description: `[circular reference to ${refName(ref)}]`,
      };
    }
    const target = resolvePointer(doc, ref);
    if (target === undefined) {
      return { description: `[broken reference: ${ref}]` };
    }
    activeRefs.add(ref);
    const resolved = walk(target, doc, activeRefs, depth + 1);
    activeRefs.delete(ref);
    if (resolved.title === undefined) resolved.title = refName(ref);
    return resolved;
  }

  const out: Schema = {};
  for (const [key, value] of Object.entries(obj)) {
    switch (key) {
      case 'xml':
        break; // OpenAPI-only noise for a form renderer
      case 'properties':
      case 'patternProperties': {
        if (typeof value === 'object' && value !== null) {
          const props: Record<string, Schema> = {};
          for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
            props[name] = walk(sub, doc, activeRefs, depth + 1);
          }
          out[key] = props;
        }
        break;
      }
      case 'items':
      case 'additionalProperties':
      case 'additionalItems':
      case 'not': {
        if (typeof value === 'boolean') out[key] = value;
        else if (typeof value === 'object' && value !== null) {
          out[key] = walk(value, doc, activeRefs, depth + 1);
        }
        break;
      }
      case 'allOf':
      case 'oneOf':
      case 'anyOf': {
        if (Array.isArray(value)) {
          out[key] = value.map((sub) => walk(sub, doc, activeRefs, depth + 1));
        }
        break;
      }
      default:
        out[key] = value;
    }
  }

  // OpenAPI 3.0 nullable -> JSON Schema type union (3.1 already uses unions).
  if (out.nullable === true) {
    delete out.nullable;
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
  } else {
    delete out.nullable;
  }

  return out;
}
