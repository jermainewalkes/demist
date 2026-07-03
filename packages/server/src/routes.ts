import type { FastifyInstance } from 'fastify';
import { SpecError } from '@demist/core';
import { getOperationDetail } from '@demist/core';
import { buildAuth, EMPTY_AUTH, type AuthMaterial } from './auth.js';
import {
  buildRequest,
  executeRequest,
  renderRequestTranscript,
  MASK,
} from './proxy.js';
import type { TokenManager } from './oauth.js';
import type { SpecStore } from './store.js';
import { substitute } from './template.js';
import type { Vault } from './vault.js';
import type { AuthProfile, SavedRequest, WorkspaceStore } from './workspace.js';

export interface Services {
  workspace: WorkspaceStore;
  store: SpecStore;
  vault: Vault;
  tokens: TokenManager;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'api'
  );
}

function maskText(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.replaceAll(s, MASK);
  return out;
}

export function registerRoutes(app: FastifyInstance, services: Services): void {
  const { workspace, store, vault, tokens } = services;

  app.get('/api/health', async () => ({ ok: true, vaultEnabled: vault.enabled }));

  app.get('/api/workspace', async () => {
    const ws = workspace.read();
    return {
      apis: ws.apis,
      variables: ws.variables,
      requests: ws.requests,
      vaultEnabled: vault.enabled,
    };
  });

  app.put<{ Params: { name: string }; Body: { value: string } }>(
    '/api/variables/:name',
    async (req, reply) => {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(req.params.name)) {
        return reply.code(400).send({ error: 'Variable names: letters, digits, _ . - (max 64)' });
      }
      if (typeof req.body?.value !== 'string') {
        return reply.code(400).send({ error: 'Provide a string "value"' });
      }
      workspace.update((w) => {
        w.variables[req.params.name] = req.body.value;
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { name: string } }>('/api/variables/:name', async (req) => {
    workspace.update((w) => {
      delete w.variables[req.params.name];
    });
    return { ok: true };
  });

  app.post<{ Body: Omit<SavedRequest, 'id'> }>('/api/requests', async (req, reply) => {
    const { name, apiId, opId } = req.body ?? {};
    if (!name || !apiId || !opId) {
      return reply.code(400).send({ error: 'A saved request needs "name", "apiId", and "opId"' });
    }
    let id = slugify(name);
    const ws = workspace.read();
    while (ws.requests.some((r) => r.id === id)) id = `${id}-2`;
    const saved: SavedRequest = {
      id,
      name,
      apiId,
      opId,
      params: req.body.params,
      contentType: req.body.contentType,
      body: req.body.body,
    };
    workspace.update((w) => {
      w.requests.push(saved);
    });
    return saved;
  });

  app.delete<{ Params: { id: string } }>('/api/requests/:id', async (req) => {
    workspace.update((w) => {
      w.requests = w.requests.filter((r) => r.id !== req.params.id);
    });
    return { ok: true };
  });

  app.post<{ Body: { url?: string; text?: string; id?: string; name?: string } }>(
    '/api/apis',
    async (req, reply) => {
      const { url, text } = req.body ?? {};
      if (!url && !text) {
        return reply.code(400).send({ error: 'Provide a spec "url" or inline "text"' });
      }
      try {
        const probeId = 'probe';
        const spec = url
          ? await store.ingestFromUrl(probeId, url)
          : await store.ingestFromText(probeId, text!);
        store.remove(probeId);

        const ws = workspace.read();
        let id = req.body.id && ID_RE.test(req.body.id)
          ? req.body.id
          : slugify(req.body.name ?? spec.index.info.title);
        while (ws.apis.some((a) => a.id === id)) id = `${id}-2`;

        // Re-ingest under the final id so the disk cache lands in the right place.
        const finalSpec = url
          ? await store.ingestFromUrl(id, url)
          : await store.ingestFromText(id, text!);

        workspace.update((w) => {
          w.apis.push({
            id,
            name: req.body.name ?? finalSpec.index.info.title,
            spec: { url },
          });
        });
        return { id, index: finalSpec.index };
      } catch (e) {
        const status = e instanceof SpecError ? 422 : 502;
        return reply.code(status).send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/apis/:id', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.code(400).send({ error: 'Bad id' });
    store.remove(req.params.id);
    workspace.update((w) => {
      w.apis = w.apis.filter((a) => a.id !== req.params.id);
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/apis/:id', async (req, reply) => {
    const entry = workspace.read().apis.find((a) => a.id === req.params.id);
    if (!entry) return reply.code(404).send({ error: `Unknown API: ${req.params.id}` });
    try {
      const spec = await store.get(entry.id, entry.spec.url);
      return { entry, index: spec.index };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get<{ Params: { id: string; opId: string } }>(
    '/api/apis/:id/operations/:opId',
    async (req, reply) => {
      const entry = workspace.read().apis.find((a) => a.id === req.params.id);
      if (!entry) return reply.code(404).send({ error: `Unknown API: ${req.params.id}` });
      const spec = await store.get(entry.id, entry.spec.url);
      const summary = spec.index.operations.find((o) => o.id === req.params.opId);
      if (!summary) return reply.code(404).send({ error: `Unknown operation: ${req.params.opId}` });
      return getOperationDetail(spec.doc, summary);
    },
  );

  app.put<{ Params: { id: string }; Body: { server?: string; auth?: AuthProfile | null } }>(
    '/api/apis/:id/config',
    async (req, reply) => {
      const ws = workspace.read();
      const entry = ws.apis.find((a) => a.id === req.params.id);
      if (!entry) return reply.code(404).send({ error: `Unknown API: ${req.params.id}` });
      workspace.update((w) => {
        const target = w.apis.find((a) => a.id === req.params.id)!;
        if (req.body.server !== undefined) target.server = req.body.server || undefined;
        if (req.body.auth !== undefined) target.auth = req.body.auth ?? undefined;
      });
      return { ok: true };
    },
  );

  app.get('/api/secrets', async () => ({
    enabled: vault.enabled,
    names: vault.enabled ? vault.list() : [],
  }));

  app.put<{ Params: { name: string }; Body: { value: string } }>(
    '/api/secrets/:name',
    async (req, reply) => {
      if (!vault.enabled) {
        return reply
          .code(409)
          .send({ error: 'Vault disabled: start demist with DEMIST_VAULT_KEY set' });
      }
      if (typeof req.body?.value !== 'string' || req.body.value === '') {
        return reply.code(400).send({ error: 'Provide a non-empty "value"' });
      }
      vault.set(req.params.name, req.body.value);
      return { ok: true };
    },
  );

  app.delete<{ Params: { name: string } }>('/api/secrets/:name', async (req, reply) => {
    if (!vault.enabled) return reply.code(409).send({ error: 'Vault disabled' });
    vault.delete(req.params.name);
    return { ok: true };
  });

  app.post<{
    Body: {
      apiId: string;
      opId: string;
      params?: { path?: Record<string, unknown>; query?: Record<string, unknown>; header?: Record<string, unknown> };
      contentType?: string;
      body?: unknown;
      baseUrl?: string;
      dryRun?: boolean;
    };
  }>('/api/execute', async (req, reply) => {
    const { apiId, opId, params, contentType, body, baseUrl, dryRun } = req.body ?? {};
    const ws = workspace.read();
    const entry = ws.apis.find((a) => a.id === apiId);
    if (!entry) return reply.code(404).send({ error: `Unknown API: ${apiId}` });
    const spec = await store.get(entry.id, entry.spec.url);
    const summary = spec.index.operations.find((o) => o.id === opId);
    if (!summary) return reply.code(404).send({ error: `Unknown operation: ${opId}` });

    // Resolve the base URL: explicit override > workspace choice > spec's first server.
    // Relative server URLs (petstore declares "/api/v3") resolve against the spec's URL.
    let base = baseUrl || entry.server || spec.index.servers[0];
    if (!base) {
      return reply.code(400).send({ error: 'No base URL: the spec declares no servers — set one' });
    }

    // {{var.x}} / {{secret.x}} substitution across every user-supplied field.
    const subst = substitute(
      {
        base,
        path: params?.path ?? {},
        query: params?.query ?? {},
        header: params?.header ?? {},
        body,
      },
      { variables: ws.variables, getSecret: vault.enabled ? (n) => vault.get(n) : undefined },
    );
    if (subst.missing.length > 0 && !dryRun) {
      return reply.code(400).send({
        error: `Unresolved reference(s): ${subst.missing.map((m) => `{{${m}}}`).join(', ')}`,
      });
    }
    base = subst.value.base;
    if (base.startsWith('/') && entry.spec.url) {
      base = new URL(base, entry.spec.url).toString();
    }
    if (!/^https?:\/\//.test(base)) {
      return reply.code(400).send({ error: `Base URL is not absolute: ${base}` });
    }

    let auth: AuthMaterial = EMPTY_AUTH;
    if (entry.auth?.scheme) {
      const scheme = spec.index.securitySchemes[entry.auth.scheme];
      if (!scheme) {
        return reply
          .code(400)
          .send({ error: `Auth profile references unknown security scheme "${entry.auth.scheme}"` });
      }
      if (!vault.enabled) {
        return reply.code(409).send({ error: 'Auth configured but vault is disabled (set DEMIST_VAULT_KEY)' });
      }
      const secretValue = entry.auth.secret ? vault.get(entry.auth.secret) : undefined;
      if (secretValue === undefined) {
        return reply
          .code(409)
          .send({ error: `Secret "${entry.auth.secret}" not found in vault — add it first` });
      }
      if (entry.auth.mode === 'client_credentials') {
        const flows = scheme.flows ?? {};
        const tokenUrl =
          flows.clientCredentials?.tokenUrl ??
          Object.values(flows).find((f) => f.tokenUrl)?.tokenUrl;
        if (!tokenUrl) {
          return reply
            .code(400)
            .send({ error: `Scheme "${entry.auth.scheme}" declares no tokenUrl for client credentials` });
        }
        if (!entry.auth.clientId) {
          return reply.code(400).send({ error: 'Client-credentials auth needs a clientId' });
        }
        if (dryRun) {
          // Previews must never trigger a real token fetch.
          auth = { headers: { authorization: `Bearer ${MASK}` }, query: {}, maskValues: [] };
        } else {
          try {
            const token = await tokens.getToken(
              entry.id,
              tokenUrl,
              entry.auth.clientId,
              secretValue,
              entry.auth.scopes ?? [],
            );
            auth = {
              headers: { authorization: `Bearer ${token}` },
              query: {},
              maskValues: [token, secretValue],
            };
          } catch (e) {
            return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
          }
        }
      } else {
        try {
          auth = buildAuth(scheme, entry.auth, secretValue);
        } catch (e) {
          return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    let built;
    try {
      built = buildRequest({
        baseUrl: base,
        method: summary.method,
        path: summary.path,
        pathParams: subst.value.path,
        query: subst.value.query,
        headers: subst.value.header,
        contentType,
        body: subst.value.body,
        auth: { ...auth, maskValues: [...auth.maskValues, ...subst.maskValues] },
      });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }

    const request = {
      method: built.method,
      url: maskText(built.url, built.maskValues),
      raw: renderRequestTranscript(built, true),
    };
    if (dryRun) return { request, missing: subst.missing };

    try {
      const result = await executeRequest(built);
      return {
        request,
        response: {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          timeMs: result.timeMs,
          truncated: result.truncated,
          bodyText: maskText(result.bodyText, built.maskValues),
          raw: maskText(result.raw, built.maskValues),
        },
      };
    } catch (e) {
      return reply.code(502).send({
        request,
        error: `Request failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });
}
