import { db } from '../store/db.js';
import { logger } from '../logger.js';

const log = logger('push');

/**
 * Web Push (PWA) notifications — reach an agent's phone even when the app is
 * closed. Optional: disabled gracefully if web-push isn't installed. Set
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in production so subscriptions survive
 * restarts (otherwise an ephemeral key pair is generated each boot).
 */
let webpush = null;
let vapid = null;

export async function initPush() {
  try {
    webpush = (await import('web-push')).default;
  } catch {
    log.warn('web-push not installed — push notifications disabled');
    return;
  }
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@omnichat.app';
  // A blank or malformed pair (e.g. a placeholder typed into a deploy form)
  // must never take the whole app down — fall back to an ephemeral pair.
  try {
    if (!pub || !priv) throw new Error('missing');
    webpush.setVapidDetails(subject, pub, priv);
  } catch (e) {
    if (e.message !== 'missing') log.warn(`invalid VAPID keys (${e.message}) — using ephemeral keys instead`);
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    webpush.setVapidDetails(subject, pub, priv);
    log.warn('generated ephemeral VAPID keys (set VAPID_PUBLIC_KEY/PRIVATE_KEY to persist)');
  }
  vapid = { pub, priv };
  log.info('web push ready');
}

export const pushEnabled = () => !!webpush && !!vapid;
export const vapidPublicKey = () => vapid?.pub || null;

/** Store (or refresh) a browser push subscription for a user. */
export function saveSubscription(userId, subscription) {
  if (!subscription?.endpoint) throw new Error('invalid subscription');
  const existing = db.pushSubscriptions.find((s) => s.endpoint === subscription.endpoint);
  if (existing) return db.pushSubscriptions.update(existing.id, { userId, subscription });
  return db.pushSubscriptions.insert({ userId, endpoint: subscription.endpoint, subscription });
}

/** Fan a payload out to all of a user's subscriptions; prune dead ones. */
export async function sendPush(userId, payload) {
  if (!pushEnabled()) return;
  for (const s of db.pushSubscriptions.filter((x) => x.userId === userId)) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.pushSubscriptions.remove(s.id);
      else log.warn(`push failed: ${e.message}`);
    }
  }
}
