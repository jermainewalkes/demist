import type { AuthMaterial } from './auth.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MASK = '••••••••';

export interface RequestInput {
  baseUrl: string;
  method: string;
  /** Templated path like /pet/{petId}. */
  path: string;
  pathParams: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  contentType?: string;
  body?: unknown;
  auth: AuthMaterial;
}

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText?: string;
  maskValues: string[];
}

export interface ExchangeResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  truncated: boolean;
  timeMs: number;
  /** Raw response transcript (status line + headers + body). */
  raw: string;
}

export function buildRequest(input: RequestInput): BuiltRequest {
  let path = input.path;
  for (const [name, value] of Object.entries(input.pathParams)) {
    if (value === undefined || value === null) continue;
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }
  const unfilled = path.match(/\{[^}]+\}/g);
  if (unfilled) {
    throw new Error(`Missing path parameter(s): ${unfilled.join(', ')}`);
  }

  const base = input.baseUrl.endsWith('/') ? input.baseUrl.slice(0, -1) : input.baseUrl;
  const url = new URL(base + path);

  for (const [name, value] of Object.entries({ ...input.query, ...input.auth.query })) {
    if (value === undefined || value === null || value === '') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(name, String(v));
    }
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined || value === null || value === '') continue;
    headers[name.toLowerCase()] = String(value);
  }
  for (const [name, value] of Object.entries(input.auth.headers)) {
    headers[name.toLowerCase()] = value;
  }

  let bodyText: string | undefined;
  if (input.body !== undefined && input.method !== 'GET' && input.method !== 'HEAD') {
    const contentType = input.contentType ?? 'application/json';
    if (contentType.includes('json')) {
      bodyText = typeof input.body === 'string' ? input.body : JSON.stringify(input.body, null, 2);
    } else if (contentType.includes('x-www-form-urlencoded')) {
      const form = new URLSearchParams();
      if (typeof input.body === 'object' && input.body !== null) {
        for (const [k, v] of Object.entries(input.body as Record<string, unknown>)) {
          if (v !== undefined && v !== null) form.append(k, String(v));
        }
      }
      bodyText = form.toString();
    } else {
      bodyText = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    }
    headers['content-type'] = contentType;
  }

  return {
    url: url.toString(),
    method: input.method,
    headers,
    bodyText,
    maskValues: input.auth.maskValues,
  };
}

/**
 * Render the request as raw HTTP/1.1 text — the de-mystifying view.
 * `masked` controls whether secret values are replaced before display;
 * anything sent to the browser must use masked=true.
 */
export function renderRequestTranscript(req: BuiltRequest, masked = true): string {
  const url = new URL(req.url);
  const lines = [
    `${req.method} ${url.pathname}${url.search} HTTP/1.1`,
    `host: ${url.host}`,
    ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`),
  ];
  let text = lines.join('\n') + '\n';
  if (req.bodyText !== undefined) text += '\n' + req.bodyText + '\n';
  if (masked) {
    for (const secret of req.maskValues) {
      if (secret) text = text.replaceAll(secret, MASK);
    }
  }
  return text;
}

export async function executeRequest(
  req: BuiltRequest,
  timeoutMs = 60_000,
): Promise<ExchangeResult> {
  const start = performance.now();
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.bodyText,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  });
  let bodyText = await res.text();
  const timeMs = Math.round(performance.now() - start);

  let truncated = false;
  if (bodyText.length > MAX_RESPONSE_BYTES) {
    bodyText = bodyText.slice(0, MAX_RESPONSE_BYTES);
    truncated = true;
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const raw =
    `HTTP/1.1 ${res.status} ${res.statusText}\n` +
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') +
    '\n\n' +
    bodyText +
    (truncated ? '\n[response truncated at 2 MB]' : '');

  return { status: res.status, statusText: res.statusText, headers, bodyText, truncated, timeMs, raw };
}
