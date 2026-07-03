import { db } from './store.js';
import { logger } from './logger.js';

const log = logger('push');

/**
 * Web Push notifications — reach the phone even when the dashboard is closed.
 * There are no per-user accounts here (one shared dashboard password), so
 * alerts are broadcast to every subscribed browser. Set VAPID keys in
 * production so subscriptions survive restarts.
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
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    log.warn('generated ephemeral VAPID keys (set VAPID_PUBLIC_KEY/PRIVATE_KEY to persist)');
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@adspy.app', pub, priv);
  vapid = { pub, priv };
  log.info('web push ready');
}

export const pushEnabled = () => !!webpush && !!vapid;
export const vapidPublicKey = () => vapid?.pub || null;

/** Store (or refresh) a browser push subscription. */
export function saveSubscription(subscription) {
  if (!subscription?.endpoint) throw new Error('invalid subscription');
  const existing = db.pushSubscriptions.find((s) => s.endpoint === subscription.endpoint);
  if (existing) return db.pushSubscriptions.update(existing.id, { subscription });
  return db.pushSubscriptions.insert({ endpoint: subscription.endpoint, subscription });
}

/** Fan a payload out to every subscribed browser; prune dead subscriptions. */
export async function broadcastPush(payload) {
  if (!pushEnabled()) return;
  for (const s of db.pushSubscriptions.all()) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.pushSubscriptions.remove(s.id);
      else log.warn(`push failed: ${e.message}`);
    }
  }
}
