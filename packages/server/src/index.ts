import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { TokenManager } from './oauth.js';
import { AuthCodeManager } from './oauth-code.js';
import { registerRoutes } from './routes.js';
import { SpecStore } from './store.js';
import { Vault } from './vault.js';
import { WorkspaceStore } from './workspace.js';

const root = process.env.DEMIST_DIR ? resolve(process.env.DEMIST_DIR) : process.cwd();
const port = Number(process.env.DEMIST_PORT ?? 4400);
const host = process.env.DEMIST_HOST ?? '127.0.0.1'; // local tool: never expose by default

const app = Fastify({ logger: { level: 'info' } });

const vault = new Vault(join(root, '.demist', 'vault.json'), process.env.DEMIST_VAULT_KEY);
registerRoutes(app, {
  workspace: new WorkspaceStore(join(root, 'demist.workspace.yaml')),
  store: new SpecStore(join(root, '.demist', 'specs')),
  vault,
  tokens: new TokenManager(),
  authCode: new AuthCodeManager(vault, `http://127.0.0.1:${port}/api/oauth/callback`),
});

// Serve the built UI when it exists (production mode); in dev, Vite serves it.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

await app.listen({ port, host });
app.log.info(`demist workspace root: ${root}`);
if (!process.env.DEMIST_VAULT_KEY) {
  app.log.warn('DEMIST_VAULT_KEY not set — the secrets vault is disabled');
}
