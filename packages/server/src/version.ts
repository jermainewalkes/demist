import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __DEMIST_VERSION__: string | undefined;

function resolveVersion(): string {
  // Injected by esbuild in the packaged bundle.
  if (typeof __DEMIST_VERSION__ === 'string') return __DEMIST_VERSION__;
  // Dev mode (tsx from source): read the repo root package.json.
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const appVersion = resolveVersion();
