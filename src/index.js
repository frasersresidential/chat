import http from 'node:http';
import { config } from './config.js';
import { createApp } from './server/app.js';
import { attachRealtime } from './server/realtime.js';
import { seedIfEmpty } from './store/seed.js';
import { applyEnvCredentials } from './store/envCredentials.js';
import { logger } from './logger.js';

const log = logger('boot');

seedIfEmpty();
applyEnvCredentials(); // copy any real keys from .env onto seeded accounts

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, () => {
  log.info(`OmniChat running → ${config.publicUrl}`);
  log.info(`Agent inbox UI:   ${config.publicUrl}/`);
  log.info(`Webhooks:         ${config.publicUrl}/webhooks/{messenger|instagram|whatsapp|line|x|tiktok|mock}`);
});
