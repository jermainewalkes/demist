// Bundle the server (core included) into a single self-contained ESM file and
// place the built web UI beside it — everything `npx demist` needs, no runtime deps.
import { build } from 'esbuild';
import { cpSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages/demist/dist');
const webDist = join(root, 'packages/web/dist');

if (!existsSync(webDist)) {
  console.error('packages/web/dist missing — run `npm run build -w @demist/web` first');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints: [join(root, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: join(outDir, 'server.mjs'),
  // CJS deps (fastify & friends) use require/__dirname internally; shim them for ESM output.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

cpSync(webDist, join(outDir, 'web'), { recursive: true });
cpSync(join(root, 'README.md'), join(root, 'packages/demist/README.md'));
console.log('bundled: packages/demist/dist/server.mjs (+ web UI)');
