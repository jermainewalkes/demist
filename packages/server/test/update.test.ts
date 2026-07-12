import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compareSemver, detectInstallMode, UpdateChecker } from '../src/update.js';

describe('compareSemver', () => {
  it('orders versions numerically, tolerating a v prefix', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('v0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', 'v0.9.9')).toBe(1);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1); // numeric, not lexicographic
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.0-beta', '1.2.0')).toBe(0); // prerelease ignored on purpose
  });
});

describe('detectInstallMode', () => {
  const cleanups: string[] = [];
  afterAll(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function dir(): string {
    const d = mkdtempSync(join(tmpdir(), 'demist-mode-'));
    cleanups.push(d);
    return d;
  }

  it('honours the env override', () => {
    expect(detectInstallMode(dir(), { DEMIST_INSTALL_MODE: 'docker' })).toBe('docker');
  });

  it('is git only for a genuine Demist checkout', () => {
    const demistClone = dir();
    mkdirSync(join(demistClone, '.git'));
    writeFileSync(join(demistClone, 'package.json'), JSON.stringify({ name: 'demist' }));
    expect(detectInstallMode(demistClone, {})).toBe('git');

    // .git belonging to some other project must not count
    const otherRepo = dir();
    mkdirSync(join(otherRepo, '.git'));
    writeFileSync(join(otherRepo, 'package.json'), JSON.stringify({ name: 'not-demist' }));
    expect(detectInstallMode(otherRepo, {})).toBe('package');

    expect(detectInstallMode(dir(), {})).toBe('package');
  });
});

describe('UpdateChecker', () => {
  let server: Server;
  let hits = 0;
  let etagHits = 0;
  let latestTag = 'v0.2.0';

  const base = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      hits++;
      if (req.headers['if-none-match'] === '"tag-etag"') {
        etagHits++;
        res.statusCode = 304;
        res.end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.setHeader('etag', '"tag-etag"');
      res.end(
        JSON.stringify({
          tag_name: latestTag,
          body: 'New: capability map improvements',
          html_url: `https://github.com/jermainewalkes/demist/releases/tag/${latestTag}`,
        }),
      );
    });
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    );
  });
  afterAll(() => server.close());

  it('reports an available update with notes and url', async () => {
    const checker = new UpdateChecker('0.1.0', 'docker', true, await base);
    const status = await checker.checkNow();
    expect(status.updateAvailable).toBe(true);
    expect(status.latest).toBe('v0.2.0');
    expect(status.notes).toContain('capability map');
    expect(status.url).toContain('/releases/tag/');
    expect(status.installMode).toBe('docker');
  });

  it('reports up to date when current >= latest', async () => {
    const checker = new UpdateChecker('0.2.0', 'git', true, await base);
    const status = await checker.checkNow();
    expect(status.updateAvailable).toBe(false);
    expect(status.notes).toBeUndefined();
  });

  it('sends the etag on re-checks and keeps state through a 304', async () => {
    const checker = new UpdateChecker('0.1.0', 'docker', true, await base);
    await checker.checkNow();
    const before = etagHits;
    const status = await checker.checkNow();
    expect(etagHits).toBe(before + 1);
    expect(status.updateAvailable).toBe(true); // cached release survives the 304
  });

  it('treats network failure as stale, not an error state', async () => {
    const checker = new UpdateChecker('0.1.0', 'docker', true, 'http://127.0.0.1:1');
    const status = await checker.checkNow();
    expect(status.updateAvailable).toBe(false);
    expect(status.lastError).toBeTruthy();

    // A previously known release survives independently of later checks.
    const okChecker = new UpdateChecker('0.1.0', 'docker', true, await base);
    await okChecker.checkNow();
    expect(okChecker.status().updateAvailable).toBe(true);
  });

  it('does nothing when disabled', async () => {
    const before = hits;
    const checker = new UpdateChecker('0.1.0', 'docker', false, await base);
    const status = await checker.checkNow();
    expect(status.enabled).toBe(false);
    expect(hits).toBe(before);
  });
});
