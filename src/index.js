import http from 'node:http';
import os from 'node:os';
import { config } from './config.js';
import { createApp } from './server/app.js';
import { attachRealtime } from './server/realtime.js';
import { db } from './store/db.js';
import { seedIfEmpty } from './store/seed.js';
import { applyEnvCredentials } from './store/envCredentials.js';
import { startReminderScheduler } from './core/reminders.js';
import { startDailyReportScheduler } from './core/dailyReport.js';
import { startSlaMonitor } from './core/sla.js';
import { initPush } from './core/push.js';
import { logger } from './logger.js';

const log = logger('boot');

await db.init();          // hydrate from Postgres when DATABASE_URL is set
await initPush();         // set up Web Push when web-push / VAPID are available
seedIfEmpty();
applyEnvCredentials(); // copy any real keys from .env onto seeded accounts

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);
startReminderScheduler();
startDailyReportScheduler();
startSlaMonitor();

/** First non-internal IPv4 — the address phones on the same Wi-Fi can reach. */
function lanAddress() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(config.port, () => {
  const lan = lanAddress();
  log.info(`OmniChat running → ${config.publicUrl}`);
  log.info(`Agent inbox UI:   ${config.publicUrl}/`);
  if (lan) log.info(`On your phone (same Wi-Fi): http://${lan}:${config.port}`);
  log.info(`Webhooks:         ${config.publicUrl}/webhooks/{messenger|instagram|whatsapp|line|x|tiktok|mock}`);
});
