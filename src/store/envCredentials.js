import { config } from '../config.js';
import { db } from './db.js';
import { logger } from '../logger.js';

const log = logger('env-credentials');

/**
 * Bridge .env → seeded channel accounts. Lets you go live without the admin UI:
 * if a credential block is present in config, it's copied onto the first
 * matching channel account of that type. Channels with no credentials simply
 * stay in "simulated" mode.
 */
export function applyEnvCredentials() {
  const map = [
    ['line', { accessToken: config.channels.line.channelAccessToken, channelSecret: config.channels.line.channelSecret }],
    ['messenger', { accessToken: config.channels.messenger.pageAccessToken, appSecret: config.channels.messenger.appSecret, verifyToken: config.channels.messenger.verifyToken }],
    ['instagram', { accessToken: config.channels.instagram.pageAccessToken, appSecret: config.channels.instagram.appSecret, verifyToken: config.channels.instagram.verifyToken }],
    ['tiktok', { accessToken: config.channels.tiktok.accessToken, clientSecret: config.channels.tiktok.clientSecret, clientKey: config.channels.tiktok.clientKey }],
    ['x', { accessToken: config.channels.x.accessToken, apiSecret: config.channels.x.apiSecret, bearerToken: config.channels.x.bearerToken }],
  ];

  for (const [type, cred] of map) {
    const hasAny = Object.values(cred).some(Boolean);
    if (!hasAny) continue;
    const account = db.channelAccounts.find((c) => c.channelType === type);
    if (!account) continue;
    const clean = Object.fromEntries(Object.entries(cred).filter(([, v]) => v));
    db.channelAccounts.update(account.id, {
      credential: { ...account.credential, ...clean },
      webhookStatus: 'configured',
    });
    log.info(`applied .env credentials to ${account.accountName}`);
  }
}
