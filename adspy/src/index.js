import http from 'node:http';
import { config } from './config.js';
import { createApp } from './server.js';
import { initPush } from './push.js';
import { seedIfEmpty, startScheduler, liveEnabled } from './core.js';
import { logger } from './logger.js';

const log = logger('boot');

await initPush();
await seedIfEmpty();

const server = http.createServer(createApp());
startScheduler();

server.listen(config.port, () => {
  log.info(`Ad Spy running → ${config.publicUrl} (${liveEnabled() ? 'LIVE Ad Library' : 'MOCK demo data'})`);
  log.info(`Login password: ADSPY_PASSWORD (default "spy1234")`);
});
