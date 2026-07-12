import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeError } from '@demist/core';

/**
 * Update awareness, not self-mutation: Demist checks GitHub Releases (at most
 * daily, ETag-cached, disable with DEMIST_NO_UPDATE_CHECK=1) and tells the UI
 * when a newer version exists. Applying the update is the platform's job —
 * `docker compose pull` for containers, `git pull` for source checkouts.
 */

export type InstallMode = 'docker' | 'git' | 'package';

export interface UpdateStatus {
  current: string;
  installMode: InstallMode;
  enabled: boolean;
  updateAvailable: boolean;
  latest?: string;
  notes?: string;
  url?: string;
  checkedAt?: number;
  lastError?: string;
}

/** Numeric semver comparison, tolerant of a leading "v": -1 | 0 | 1. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/i, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function detectInstallMode(rootDir: string, env = process.env): InstallMode {
  const forced = env.DEMIST_INSTALL_MODE;
  if (forced === 'docker' || forced === 'git' || forced === 'package') return forced;
  // "git" only when rootDir is genuinely a Demist checkout — an npm install
  // nested inside some other project's repo must not count.
  if (existsSync(join(rootDir, '.git'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
      if (pkg.name === 'demist') return 'git';
    } catch {
      /* fall through */
    }
  }
  return 'package';
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NOTES_MAX = 4000;

export class UpdateChecker {
  private latest?: { version: string; notes?: string; url?: string };
  private etag?: string;
  private checkedAt?: number;
  private lastError?: string;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly current: string,
    private readonly installMode: InstallMode,
    private readonly enabled: boolean,
    /** "owner/repo" against api.github.com, or a full base URL for tests. */
    private readonly repo = 'jermainewalkes/demist',
  ) {}

  start(): void {
    if (!this.enabled) return;
    void this.checkNow();
    this.timer = setInterval(() => void this.checkNow(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  status(): UpdateStatus {
    const updateAvailable =
      this.latest !== undefined && compareSemver(this.current, this.latest.version) < 0;
    return {
      current: this.current,
      installMode: this.installMode,
      enabled: this.enabled,
      updateAvailable,
      latest: this.latest?.version,
      notes: updateAvailable ? this.latest?.notes : undefined,
      url: updateAvailable ? this.latest?.url : undefined,
      checkedAt: this.checkedAt,
      lastError: this.lastError,
    };
  }

  /** Offline or API failure is a normal condition: status just stays stale. */
  async checkNow(): Promise<UpdateStatus> {
    if (!this.enabled) return this.status();
    const base = this.repo.startsWith('http')
      ? this.repo
      : `https://api.github.com/repos/${this.repo}`;
    try {
      const res = await fetch(`${base}/releases/latest`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `demist/${this.current}`,
          ...(this.etag ? { 'if-none-match': this.etag } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      this.checkedAt = Date.now();
      if (res.status === 304) {
        this.lastError = undefined;
        return this.status();
      }
      if (!res.ok) {
        this.lastError = `release check: HTTP ${res.status}`;
        return this.status();
      }
      this.etag = res.headers.get('etag') ?? undefined;
      const data = (await res.json()) as {
        tag_name?: string;
        body?: string;
        html_url?: string;
      };
      if (typeof data.tag_name === 'string') {
        this.latest = {
          version: data.tag_name,
          notes: typeof data.body === 'string' ? data.body.slice(0, NOTES_MAX) : undefined,
          url: typeof data.html_url === 'string' ? data.html_url : undefined,
        };
        this.lastError = undefined;
      }
    } catch (e) {
      this.checkedAt = Date.now();
      this.lastError = describeError(e);
    }
    return this.status();
  }
}
