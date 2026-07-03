/**
 * Template substitution for request inputs: any string anywhere in the params,
 * body, or base URL may reference `{{var.name}}` (plain workspace variables) or
 * `{{secret.name}}` (vault entries). Secrets resolved this way join the mask
 * list, so they behave exactly like auth secrets in transcripts.
 */

const PLACEHOLDER = /\{\{\s*(var|secret)\.([A-Za-z0-9_.-]+)\s*\}\}/g;

export interface TemplateContext {
  variables: Record<string, string>;
  /** undefined when the vault is disabled. */
  getSecret?: (name: string) => string | undefined;
}

export interface SubstitutionResult<T> {
  value: T;
  /** Secret values that were injected and must be masked in transcripts. */
  maskValues: string[];
  /** Unresolvable references, e.g. "var.project_id". */
  missing: string[];
}

export function substitute<T>(input: T, ctx: TemplateContext): SubstitutionResult<T> {
  const maskValues = new Set<string>();
  const missing = new Set<string>();

  function resolveString(s: string): string {
    return s.replace(PLACEHOLDER, (whole, kind: string, name: string) => {
      if (kind === 'var') {
        const v = ctx.variables[name];
        if (v === undefined) {
          missing.add(`var.${name}`);
          return whole;
        }
        return v;
      }
      const v = ctx.getSecret?.(name);
      if (v === undefined) {
        missing.add(`secret.${name}`);
        return whole;
      }
      maskValues.add(v);
      return v;
    });
  }

  function walk(node: unknown): unknown {
    if (typeof node === 'string') return resolveString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  }

  return {
    value: walk(input) as T,
    maskValues: [...maskValues],
    missing: [...missing],
  };
}
