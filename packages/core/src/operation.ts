import { resolvePointer, resolveSchema } from './deref.js';
import { asObject } from './normalize.js';
import {
  BodyVariant,
  OperationDetail,
  OperationSummary,
  ParameterDetail,
  ResponseSummary,
  SecurityRequirement,
} from './types.js';

/**
 * Resolve one operation into a self-contained, form-ready description.
 * All $ref resolution happens here, on demand — the index stays lightweight.
 */
export function getOperationDetail(
  doc: Record<string, unknown>,
  summary: OperationSummary,
): OperationDetail {
  const paths = asObject(doc.paths) ?? {};
  let pathItem = asObject(paths[summary.path]);
  if (pathItem && typeof pathItem.$ref === 'string') {
    pathItem = asObject(resolvePointer(doc, pathItem.$ref));
  }
  const op = asObject(pathItem?.[summary.method.toLowerCase()]);
  if (!pathItem || !op) {
    throw new Error(`Operation not found: ${summary.method} ${summary.path}`);
  }

  const parameters = mergeParameters(doc, pathItem.parameters, op.parameters);

  let body: OperationDetail['body'];
  let requestBody = asObject(op.requestBody);
  if (requestBody && typeof requestBody.$ref === 'string') {
    requestBody = asObject(resolvePointer(doc, requestBody.$ref));
  }
  if (requestBody) {
    const variants: BodyVariant[] = [];
    const content = asObject(requestBody.content) ?? {};
    for (const [contentType, mediaRaw] of Object.entries(content)) {
      const media = asObject(mediaRaw);
      variants.push({
        contentType,
        schema: resolveSchema(doc, media?.schema ?? {}),
      });
    }
    // JSON first: it's what the form renderer handles best.
    variants.sort((a, b) => rank(a.contentType) - rank(b.contentType));
    body = { required: requestBody.required === true, variants };
  }

  const responses: ResponseSummary[] = [];
  for (const [status, resRaw] of Object.entries(asObject(op.responses) ?? {})) {
    let res = asObject(resRaw);
    if (res && typeof res.$ref === 'string') res = asObject(resolvePointer(doc, res.$ref));
    responses.push({
      status,
      description: typeof res?.description === 'string' ? res.description : undefined,
      contentTypes: Object.keys(asObject(res?.content) ?? {}),
    });
  }

  const security = (Array.isArray(op.security) ? op.security : doc.security) as unknown;

  return {
    ...summary,
    description: typeof op.description === 'string' ? op.description : undefined,
    parameters,
    body,
    responses,
    security: Array.isArray(security) ? (security as SecurityRequirement[]) : [],
  };
}

function rank(contentType: string): number {
  if (contentType.includes('json')) return 0;
  if (contentType.includes('x-www-form-urlencoded')) return 1;
  return 2;
}

function mergeParameters(
  doc: Record<string, unknown>,
  pathLevel: unknown,
  opLevel: unknown,
): ParameterDetail[] {
  const byKey = new Map<string, ParameterDetail>();
  for (const raw of [
    ...(Array.isArray(pathLevel) ? pathLevel : []),
    ...(Array.isArray(opLevel) ? opLevel : []),
  ]) {
    let param = asObject(raw);
    if (param && typeof param.$ref === 'string') {
      param = asObject(resolvePointer(doc, param.$ref));
    }
    if (!param || typeof param.name !== 'string' || typeof param.in !== 'string') continue;
    byKey.set(`${param.in}:${param.name}`, {
      name: param.name,
      in: param.in,
      required: param.in === 'path' ? true : param.required === true,
      description: typeof param.description === 'string' ? param.description : undefined,
      schema: resolveSchema(doc, param.schema ?? { type: 'string' }),
    });
  }
  const order = { path: 0, query: 1, header: 2, cookie: 3 } as Record<string, number>;
  return [...byKey.values()].sort((a, b) => (order[a.in] ?? 9) - (order[b.in] ?? 9));
}
