import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { sendPush } from './push.js';

/**
 * In-app notifications. The realtime layer relays 'notification:created' to the
 * target user's open sockets. Persisted so unseen notifications survive a
 * reconnect. Also delivered as a Web Push (when the user has subscribed) so it
 * reaches their phone even with the app closed.
 */
export function notify(userId, { type, title, body, conversationId = null }) {
  if (!userId) return null;
  const n = db.notifications.insert({
    userId,
    type,
    title,
    body,
    conversationId,
    read: false,
  });
  bus.emit('notification:created', n);
  sendPush(userId, { title, body, conversationId, type });
  return n;
}

export function listNotifications(userId) {
  return db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function markRead(id) {
  return db.notifications.update(id, { read: true });
}
