import yaml from 'js-yaml';
import { describeError, SpecError } from './types.js';

const MAX_SPEC_BYTES = 30 * 1024 * 1024;

/** Parse spec text as JSON first (fast path), falling back to YAML. */
export function parseSpecText(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = yaml.load(text);
    } catch (e) {
      throw new SpecError(`Not valid JSON or YAML: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new SpecError('Spec must be a JSON/YAML object at the top level');
  }
  return doc as Record<string, unknown>;
}

export async function fetchSpec(url: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SpecError(`Invalid spec URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SpecError(`Unsupported spec URL scheme: ${parsed.protocol}`);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json, application/yaml, text/yaml, text/plain, */*' },
      redirect: 'follow',
    });
  } catch (e) {
    throw new SpecError(`Could not fetch spec: ${describeError(e)}`);
  }
  if (!res.ok) {
    throw new SpecError(`Spec fetch failed: HTTP ${res.status} from ${url}`);
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_SPEC_BYTES) {
    throw new SpecError(`Spec too large (${len} bytes; limit ${MAX_SPEC_BYTES})`);
  }
  const text = await res.text();
  if (text.length > MAX_SPEC_BYTES) {
    throw new SpecError(`Spec too large (${text.length} bytes; limit ${MAX_SPEC_BYTES})`);
  }
  return parseSpecText(text);
}
