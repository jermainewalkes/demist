import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getOperationDetail,
  normalizeSpec,
  parseSpecText,
  SpecError,
} from '../src/index.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
}

describe('parseSpecText', () => {
  it('parses JSON', () => {
    expect(parseSpecText('{"openapi": "3.0.0"}')).toEqual({ openapi: '3.0.0' });
  });

  it('falls back to YAML', () => {
    const doc = parseSpecText('openapi: 3.1.0\ninfo:\n  title: Yam\n  version: "1"\n');
    expect(doc.openapi).toBe('3.1.0');
  });

  it('rejects garbage', () => {
    expect(() => parseSpecText(':::[not a spec')).toThrow(SpecError);
  });

  it('rejects non-object documents', () => {
    expect(() => parseSpecText('[1, 2, 3]')).toThrow(SpecError);
  });
});

describe('normalizeSpec: petstore (OpenAPI 3.0)', () => {
  it('indexes operations, servers, and security schemes', async () => {
    const { index } = await normalizeSpec(loadFixture('petstore-3.0.json'));
    expect(index.info.title).toMatch(/petstore/i);
    expect(index.operations.length).toBeGreaterThan(10);
    expect(index.servers).toContain('/api/v3');
    expect(index.securitySchemes.api_key?.type).toBe('apiKey');

    const getPet = index.operations.find((o) => o.id === 'getPetById');
    expect(getPet).toMatchObject({ method: 'GET', path: '/pet/{petId}', hasBody: false });
  });

  it('resolves an operation detail with form-ready schemas', async () => {
    const { doc, index } = await normalizeSpec(loadFixture('petstore-3.0.json'));
    const summary = index.operations.find((o) => o.id === 'getPetById')!;
    const detail = getOperationDetail(doc, summary);
    const petId = detail.parameters.find((p) => p.name === 'petId');
    expect(petId).toMatchObject({ in: 'path', required: true });
    expect(petId?.schema.type).toBe('integer');

    const addPet = index.operations.find((o) => o.id === 'addPet')!;
    const addDetail = getOperationDetail(doc, addPet);
    const json = addDetail.body?.variants.find((v) => v.contentType === 'application/json');
    expect(json).toBeDefined();
    const props = json?.schema.properties as Record<string, Record<string, unknown>>;
    expect(props.name.type).toBe('string');
    expect(addDetail.security.length).toBeGreaterThan(0);
  });
});

describe('normalizeSpec: Swagger 2.0 upconversion', () => {
  it('converts and indexes operations', async () => {
    const { doc, index } = await normalizeSpec(loadFixture('swagger-2.0.json'));
    expect(index.warnings.join(' ')).toMatch(/converted from swagger 2\.0/i);
    expect(index.operations.map((o) => o.id).sort()).toEqual([
      'createNote',
      'deleteNote',
      'listNotes',
    ]);
    expect(index.servers).toEqual(['https://notes.example.com/v1']);
    expect(index.securitySchemes.api_key).toMatchObject({
      type: 'apiKey',
      name: 'X-Api-Key',
      in: 'header',
    });

    const create = index.operations.find((o) => o.id === 'createNote')!;
    expect(create.hasBody).toBe(true);
    const detail = getOperationDetail(doc, create);
    const json = detail.body?.variants.find((v) => v.contentType === 'application/json');
    expect(json?.schema.required).toEqual(['title']);
    // Document-level security applies when the operation declares none.
    expect(detail.security).toEqual([{ api_key: [] }]);
  });

  it('merges path-level parameters into operations', async () => {
    const { doc, index } = await normalizeSpec(loadFixture('swagger-2.0.json'));
    const del = index.operations.find((o) => o.id === 'deleteNote')!;
    const detail = getOperationDetail(doc, del);
    expect(detail.parameters).toHaveLength(1);
    expect(detail.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
  });
});

describe('normalizeSpec: circular references', () => {
  it('cuts cycles and converts nullable', async () => {
    const { doc, index } = await normalizeSpec(loadFixture('circular-3.0.json'));
    const detail = getOperationDetail(doc, index.operations[0]);
    const schema = detail.body!.variants[0].schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(props.label.type).toEqual(['string', 'null']);
    // children -> items is a cycle back to TreeNode: must terminate with a stub
    const items = (props.children.items ?? {}) as Record<string, unknown>;
    expect(String(items.description)).toMatch(/circular reference/i);
    expect(String((props.parent as Record<string, unknown>).description)).toMatch(
      /circular reference/i,
    );
    // The whole thing must be JSON-serializable (no actual cycles)
    expect(() => JSON.stringify(schema)).not.toThrow();
  });
});

describe('normalizeSpec: graceful degradation', () => {
  it('keeps good operations, warns on bad ones, stubs broken refs', async () => {
    const { doc, index } = await normalizeSpec(loadFixture('broken.json'));
    expect(index.operations.map((o) => o.id).sort()).toEqual(['danglingRef', 'worksFine']);
    expect(index.warnings.join(' ')).toMatch(/\/bad/);

    const detail = getOperationDetail(
      doc,
      index.operations.find((o) => o.id === 'danglingRef')!,
    );
    // Broken parameter $ref is dropped; broken schema $ref becomes an annotated stub
    expect(detail.parameters).toHaveLength(0);
    const schema = detail.body!.variants[0].schema;
    expect(String(schema.description)).toMatch(/broken reference/i);
  });

  it('rejects documents that are not OpenAPI at all', async () => {
    await expect(normalizeSpec({ name: 'not a spec' })).rejects.toThrow(SpecError);
    await expect(normalizeSpec({ openapi: '4.0.0' })).rejects.toThrow(SpecError);
  });

  it('de-duplicates colliding operationIds', async () => {
    const { index } = await normalizeSpec({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {
        '/a': { get: { operationId: 'dup', responses: {} } },
        '/b': { get: { operationId: 'dup', responses: {} } },
      },
    });
    expect(new Set(index.operations.map((o) => o.id)).size).toBe(2);
  });
});

describe('large specs', () => {
  const githubSpec = join(fixtures, 'github-3.1.json');

  it.skipIf(!existsSync(githubSpec))(
    'indexes GitHub\'s ~10 MB spec quickly (lazy resolution)',
    async () => {
      const raw = JSON.parse(readFileSync(githubSpec, 'utf8'));
      const start = performance.now();
      const { doc, index } = await normalizeSpec(raw);
      const indexMs = performance.now() - start;
      expect(index.operations.length).toBeGreaterThan(500);

      const detailStart = performance.now();
      const op = index.operations.find((o) => o.id === 'repos/create-webhook')
        ?? index.operations.find((o) => o.hasBody)!;
      const detail = getOperationDetail(doc, op);
      const detailMs = performance.now() - detailStart;
      expect(detail.body?.variants.length).toBeGreaterThan(0);

      // Generous bounds — the point is "no full-document dereference".
      expect(indexMs).toBeLessThan(5000);
      expect(detailMs).toBeLessThan(1000);
    },
  );
});

describe('describeError', () => {
  it('surfaces the cause chain that undici hides', async () => {
    const { describeError } = await import('../src/index.js');
    const inner = new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
    const outer = new Error('fetch failed');
    (outer as { cause?: unknown }).cause = inner;
    expect(describeError(outer)).toBe('fetch failed — getaddrinfo ENOTFOUND raw.githubusercontent.com');
    expect(describeError(new Error('plain'))).toBe('plain');
  });

  it('reports unreachable hosts with the real reason', async () => {
    const { fetchSpec, SpecError } = await import('../src/index.js');
    const err = await fetchSpec('https://definitely-not-a-real-host-demist.invalid/spec.json', 3000)
      .then(() => null)
      .catch((e) => e as Error);
    expect(err).toBeInstanceOf(SpecError);
    expect(err!.message).toMatch(/ENOTFOUND|EAI_AGAIN|getaddrinfo/i);
  });
});
