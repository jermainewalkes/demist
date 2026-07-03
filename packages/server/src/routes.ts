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
import type { SpecStore } from './store.js';
import type { Vault } from './vault.js';
import type { AuthProfile, WorkspaceStore } from './workspace.js';

export interface Services {
  workspace: WorkspaceStore;
  store: SpecStore;
  vault: Vault;
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
  const { workspace, store, vault } = services;

  app.get('/api/health', async () => ({ ok: true, vaultEnabled: vault.enabled }));

  app.get('/api/workspace', async () => {
    const ws = workspace.read();
    return { apis: ws.apis, vaultEnabled: vault.enabled };
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
    const entry = workspace.read().apis.find((a) => a.id === apiId);
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
      try {
        auth = buildAuth(scheme, entry.auth, secretValue);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }

    let built;
    try {
      built = buildRequest({
        baseUrl: base,
        method: summary.method,
        path: summary.path,
        pathParams: params?.path ?? {},
        query: params?.query ?? {},
        headers: params?.header ?? {},
        contentType,
        body,
        auth,
      });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }

    const request = {
      method: built.method,
      url: maskText(built.url, built.maskValues),
      raw: renderRequestTranscript(built, true),
    };
    if (dryRun) return { request };

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
