import { describe, expect, it } from 'vitest';
import { diffSpecs, normalizeSpec } from '../src/index.js';

function baseSpec() {
  return {
    openapi: '3.0.3',
    info: { title: 'Diffable', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/things': {
        get: {
          operationId: 'listThings',
          summary: 'List things',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
          responses: { '200': { description: 'OK' } },
        },
        post: {
          operationId: 'createThing',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' } } },
              },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      '/legacy': {
        delete: { operationId: 'dropLegacy', responses: { '204': { description: 'Gone' } } },
      },
    },
    components: { securitySchemes: { key: { type: 'apiKey', name: 'X-K', in: 'header' } } },
  };
}

describe('diffSpecs', () => {
  it('reports identical specs as identical', async () => {
    const a = await normalizeSpec(baseSpec());
    const b = await normalizeSpec(baseSpec());
    const diff = diffSpecs(a, b);
    expect(diff.identical).toBe(true);
    expect(diff.changed).toEqual([]);
  });

  it('ignores key-order and $ref refactors', async () => {
    const refactored = baseSpec() as Record<string, any>;
    // Move the inline POST body schema into components and reference it.
    refactored.components.schemas = {
      Thing: { type: 'object', properties: { name: { type: 'string' } } },
    };
    refactored.paths['/things'].post.requestBody.content['application/json'].schema = {
      $ref: '#/components/schemas/Thing',
    };
    const diff = diffSpecs(await normalizeSpec(baseSpec()), await normalizeSpec(refactored));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it('detects added, removed, and changed operations with specific notes', async () => {
    const next = baseSpec() as Record<string, any>;
    delete next.paths['/legacy'];
    next.paths['/things/{id}'] = {
      get: { operationId: 'getThing', responses: { '200': { description: 'OK' } } },
    };
    next.paths['/things'].get.deprecated = true;
    next.paths['/things'].get.parameters.push({
      name: 'offset',
      in: 'query',
      schema: { type: 'integer' },
    });
    next.paths['/things'].post.responses['429'] = { description: 'Slow down' };
    next.info.version = '2.0.0';
    next.components.securitySchemes.bearer = { type: 'http', scheme: 'bearer' };

    const diff = diffSpecs(await normalizeSpec(baseSpec()), await normalizeSpec(next));
    expect(diff.identical).toBe(false);
    expect(diff.oldVersion).toBe('1.0.0');
    expect(diff.newVersion).toBe('2.0.0');
    expect(diff.added.map((o) => `${o.method} ${o.path}`)).toEqual(['GET /things/{id}']);
    expect(diff.removed.map((o) => `${o.method} ${o.path}`)).toEqual(['DELETE /legacy']);
    expect(diff.schemesAdded).toEqual(['bearer']);

    const getChange = diff.changed.find((c) => c.method === 'GET' && c.path === '/things');
    expect(getChange?.notes).toContain('now deprecated');
    expect(getChange?.notes).toContain('parameter added: offset (query)');
    const postChange = diff.changed.find((c) => c.method === 'POST' && c.path === '/things');
    expect(postChange?.notes).toContain('response added: 429');
  });

  it('flags required flips and server changes', async () => {
    const next = baseSpec() as Record<string, any>;
    next.paths['/things'].get.parameters[0].required = true;
    next.servers = [{ url: 'https://api2.example.com' }];
    const diff = diffSpecs(await normalizeSpec(baseSpec()), await normalizeSpec(next));
    const getChange = diff.changed.find((c) => c.method === 'GET');
    expect(getChange?.notes).toContain('parameter limit is now required');
    expect(diff.serversChanged).toEqual({
      old: ['https://api.example.com'],
      new: ['https://api2.example.com'],
    });
  });
});
