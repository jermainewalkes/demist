// Reproducible README screenshot: builds the app, starts a demist server against
// a seeded scratch workspace, renders it with headless Chrome and writes
// docs/screenshot-dark.png. No hand grabs — run `node scripts/screenshot.mjs`.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4470;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'packages/demist/dist/server.mjs'))) {
  console.error('Run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error('Google Chrome not found — needed for the headless render.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'demist-shot-'));
const server = spawn('node', [join(root, 'packages/demist/bin/demist.mjs')], {
  env: { ...process.env, DEMIST_DIR: work, DEMIST_PORT: String(PORT), DEMIST_VAULT_KEY: 'screenshot' },
  stdio: 'ignore',
});

async function api(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      await api('/api/health');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  // Seed a believable workspace: two APIs and a couple of variables.
  await api('/api/apis', { url: 'https://petstore3.swagger.io/api/v3/openapi.json' });
  await api('/api/apis', { url: 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml' });
  await fetch(`http://127.0.0.1:${PORT}/api/variables/pokemon_name`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'pikachu' }),
  });

  execFileSync(CHROME, [
    '--headless=new',
    '--hide-scrollbars',
    '--force-dark-mode',
    '--window-size=1440,900',
    `--screenshot=${join(root, 'docs/screenshot-dark.png')}`,
    '--virtual-time-budget=6000',
    // Deep-link straight to an operation so the shot shows forms + the HTTP preview.
    `http://127.0.0.1:${PORT}/#swagger-petstore-openapi-3-0/findPetsByStatus`,
  ]);
  console.log('wrote docs/screenshot-dark.png');
} finally {
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
