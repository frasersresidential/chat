import express from 'express';
import { db } from '../store/db.js';
import { getAdapter } from '../channels/registry.js';
import { ingestInbound } from '../core/conversations.js';
import { logger } from '../logger.js';

const log = logger('webhooks');

/**
 * Mounts /webhooks/:channel (GET for subscription challenges, POST for events).
 * Each request is resolved to a specific ChannelAccount so one endpoint serves
 * many connected accounts of the same type.
 */
export function mountWebhooks(app) {
  // GET — platform subscription / verification handshakes.
  app.get('/webhooks/:channel', (req, res) => {
    const adapter = getAdapter(req.params.channel);
    if (!adapter) return res.sendStatus(404);

    // Find the account this challenge belongs to (by verify token or first match).
    const accounts = db.channelAccounts.filter((c) => c.channelType === req.params.channel);
    const account =
      accounts.find((a) => a.credential?.verifyToken && a.credential.verifyToken === req.query['hub.verify_token']) ||
      accounts[0];

    const challenge = adapter.verifyChallenge(req.query, account);
    if (challenge !== null && challenge !== undefined) {
      if (account) db.channelAccounts.update(account.id, { webhookStatus: 'verified' });
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  // POST — inbound events. Raw body required for signature verification.
  app.post('/webhooks/:channel', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    const adapter = getAdapter(req.params.channel);
    if (!adapter) return res.sendStatus(404);

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    let body;
    try {
      body = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      return res.status(400).json({ error: 'invalid JSON' });
    }

    const externalId = adapter.resolveAccountId(body);
    const account = db.channelAccounts.find(
      (c) => c.channelType === req.params.channel &&
        (c.accountId === externalId || (req.params.channel === 'mock' && c.accountId === (externalId || 'mock_main'))),
    );

    if (!account) {
      log.warn(`no channel account for ${req.params.channel} id=${externalId}`);
      return res.sendStatus(200); // ack so the platform stops retrying
    }

    if (!adapter.verifySignature(raw, req.headers, account)) {
      log.warn(`signature verification failed for ${account.accountName}`);
      return res.sendStatus(403);
    }

    try {
      const inbound = adapter.parseInbound(body, account);
      for (const msg of inbound) {
        if (!msg.participantId) continue;
        ingestInbound(account, msg);
      }
    } catch (e) {
      log.error(`ingest failed: ${e.message}`);
    }

    // Always 200 quickly — platforms retry aggressively on non-2xx.
    res.sendStatus(200);
  });
}
