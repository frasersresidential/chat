import http from 'node:http';
import os from 'node:os';
import { createStudioApp } from './app.js';
import { db } from '../store/db.js';
import { seedIfEmpty } from '../store/seed.js';
import { applyEnvCredentials } from '../store/envCredentials.js';
import { logger } from '../logger.js';

const log = logger('studio-boot');

// Gamification Studio runs as its own service, separate from the OmniChat
// inbox. It shares the same data store (Postgres when DATABASE_URL is set) and
// the same login accounts, but exposes only the lucky-draw games + reports.
await db.init();
seedIfEmpty();
applyEnvCredentials();

const app = createStudioApp();
const server = http.createServer(app);

// Its own port so it can run next to the inbox during local development.
const port = Number(process.env.STUDIO_PORT || process.env.PORT || 3100);

function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(port, () => {
  const lan = lanAddress();
  log.info(`Gamification Studio running → http://localhost:${port}`);
  log.info(`Admin console:  http://localhost:${port}/`);
  log.info(`Customer game:  http://localhost:${port}/games.html?c=game_lucky_draw`);
  if (lan) log.info(`On your phone (same Wi-Fi): http://${lan}:${port}`);
});
