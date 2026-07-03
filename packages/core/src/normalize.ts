/// <reference path="./swagger2openapi.d.ts" />
import { convertObj } from 'swagger2openapi';
import { resolvePointer } from './deref.js';
import {
  ApiIndex,
  OperationSummary,
  SecurityScheme,
  SpecError,
} from './types.js';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export interface NormalizedSpec {
  /** The document, upconverted to OpenAPI 3.x. Kept for lazy per-operation resolution. */
  doc: Record<string, unknown>;
  index: ApiIndex;
}

/**
 * Turn any raw spec object (Swagger 2.0 / OpenAPI 3.0 / 3.1) into a normalized document
 * plus a lightweight operation index. Deliberately tolerant: structural problems become
 * warnings wherever possible, so partially-broken real-world specs still render.
 */
export async function normalizeSpec(raw: Record<string, unknown>): Promise<NormalizedSpec> {
  const warnings: string[] = [];
  let doc = raw;

  if (typeof raw.swagger === 'string') {
    if (raw.swagger !== '2.0') {
      throw new SpecError(`Unsupported swagger version: ${raw.swagger}`);
    }
    try {
      const result = await convertObj(raw, { patch: true, warnOnly: true });
      doc = result.openapi;
      warnings.push('Converted from Swagger 2.0 to OpenAPI 3.0');
    } catch (e) {
      throw new SpecError(
        `Swagger 2.0 conversion failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  } else if (typeof raw.openapi !== 'string') {
    throw new SpecError(
      'Not an OpenAPI document: missing top-level "openapi" (3.x) or "swagger" (2.0) field',
    );
  } else if (!raw.openapi.startsWith('3.')) {
    throw new SpecError(`Unsupported OpenAPI version: ${raw.openapi}`);
  }

  const infoRaw = asObject(doc.info) ?? {};
  const info = {
    title: typeof infoRaw.title === 'string' ? infoRaw.title : '(untitled API)',
    version: typeof infoRaw.version === 'string' ? infoRaw.version : '',
    description: typeof infoRaw.description === 'string' ? infoRaw.description : undefined,
  };
  if (!asObject(doc.info)) warnings.push('Spec has no "info" object');

  const servers = extractServers(doc);
  if (servers.length === 0) {
    warnings.push('Spec declares no servers — set a base URL manually before sending requests');
  }

  const paths = asObject(doc.paths);
  if (!paths) {
    warnings.push('Spec has no "paths" object — no operations to show');
  }

  const operations: OperationSummary[] = [];
  const seenIds = new Set<string>();
  for (const [path, pathItemRaw] of Object.entries(paths ?? {})) {
    if (!path.startsWith('/')) continue; // skips extensions like x-...
    let pathItem = asObject(pathItemRaw);
    if (pathItem && typeof pathItem.$ref === 'string') {
      pathItem = asObject(resolvePointer(doc, pathItem.$ref));
    }
    if (!pathItem) {
      warnings.push(`Path item for ${path} is not an object — skipped`);
      continue;
    }
    for (const method of HTTP_METHODS) {
      const op = asObject(pathItem[method]);
      if (!op) continue;
      let id = typeof op.operationId === 'string' && op.operationId.trim() !== ''
        ? op.operationId
        : `${method.toUpperCase()} ${path}`;
      while (seenIds.has(id)) id = `${id}~`;
      seenIds.add(id);
      const tags = Array.isArray(op.tags)
        ? op.tags.filter((t): t is string => typeof t === 'string')
        : [];
      operations.push({
        id,
        method: method.toUpperCase(),
        path,
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        tags: tags.length > 0 ? tags : ['(untagged)'],
        deprecated: op.deprecated === true,
        hasBody: asObject(op.requestBody) !== undefined,
      });
    }
  }

  return {
    doc,
    index: {
      info,
      servers,
      operations,
      securitySchemes: extractSecuritySchemes(doc),
      warnings,
    },
  };
}

function extractServers(doc: Record<string, unknown>): string[] {
  const servers = doc.servers;
  if (!Array.isArray(servers)) return [];
  const urls: string[] = [];
  for (const s of servers) {
    const server = asObject(s);
    if (!server || typeof server.url !== 'string') continue;
    // Substitute server variables with their defaults, e.g. {region}.api.example.com
    let url = server.url;
    const variables = asObject(server.variables);
    if (variables) {
      for (const [name, v] of Object.entries(variables)) {
        const def = asObject(v)?.default;
        if (typeof def === 'string') url = url.replaceAll(`{${name}}`, def);
      }
    }
    urls.push(url);
  }
  return urls;
}

function extractSecuritySchemes(doc: Record<string, unknown>): Record<string, SecurityScheme> {
  const schemes: Record<string, SecurityScheme> = {};
  const raw = asObject(asObject(doc.components)?.securitySchemes);
  if (!raw) return schemes;
  for (const [key, valueRaw] of Object.entries(raw)) {
    let value = asObject(valueRaw);
    if (value && typeof value.$ref === 'string') {
      value = asObject(resolvePointer(doc, value.$ref));
    }
    if (!value || typeof value.type !== 'string') continue;
    let flows: SecurityScheme['flows'];
    const rawFlows = asObject(value.flows);
    if (rawFlows) {
      flows = {};
      for (const [flowName, flowRaw] of Object.entries(rawFlows)) {
        const flow = asObject(flowRaw);
        if (!flow) continue;
        flows[flowName] = {
          authorizationUrl:
            typeof flow.authorizationUrl === 'string' ? flow.authorizationUrl : undefined,
          tokenUrl: typeof flow.tokenUrl === 'string' ? flow.tokenUrl : undefined,
          scopes: asObject(flow.scopes) as Record<string, string> | undefined,
        };
      }
    }
    schemes[key] = {
      type: value.type,
      description: typeof value.description === 'string' ? value.description : undefined,
      name: typeof value.name === 'string' ? value.name : undefined,
      in: typeof value.in === 'string' ? value.in : undefined,
      scheme: typeof value.scheme === 'string' ? value.scheme : undefined,
      flows,
    };
  }
  return schemes;
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
