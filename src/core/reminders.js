import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { notify } from './notifications.js';
import { can, PERMISSIONS } from './rbac.js';
import { logger } from '../logger.js';

const log = logger('reminders');

/**
 * Follow-up reminders / tasks. An agent schedules "chase this customer at T"
 * on a conversation; when due, the owner gets a notification. A lightweight
 * scheduler polls for due reminders (good enough for a single node).
 *
 * Reminder: { id, organizationId, conversationId, userId, createdBy,
 *             dueAt, note, done, doneAt, notified }
 */
export function createReminder({ organizationId, conversationId, userId, createdBy, dueAt, note }) {
  const t = new Date(dueAt);
  if (Number.isNaN(t.getTime())) throw new Error('invalid dueAt');
  const r = db.reminders.insert({
    organizationId, conversationId: conversationId || null,
    userId, createdBy, dueAt: t.toISOString(),
    note: String(note || '').trim(), done: false, doneAt: null, notified: false,
  });
  if (conversationId && db.conversations.get(conversationId)) {
    bus.emit('conversation:upserted', db.conversations.get(conversationId));
  }
  return r;
}

/** Reminders for a user (default) or the whole org for managers/viewers. */
export function listReminders(user, scope = 'mine') {
  const all = db.reminders.filter((r) => r.organizationId === user.organizationId);
  const rows = (scope === 'all' && can(user, PERMISSIONS.VIEW_ALL_CONVERSATIONS))
    ? all
    : all.filter((r) => r.userId === user.id);
  return rows.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

export function remindersForConversation(conversationId) {
  return db.reminders
    .filter((r) => r.conversationId === conversationId)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
}

export function completeReminder(id) {
  const r = db.reminders.get(id);
  if (!r) return null;
  const updated = db.reminders.update(id, { done: true, doneAt: new Date().toISOString() });
  if (r.conversationId && db.conversations.get(r.conversationId)) {
    bus.emit('conversation:upserted', db.conversations.get(r.conversationId));
  }
  return updated;
}

/** Count of pending (not done) reminders that are already due for a user. */
export function dueCount(userId) {
  const now = Date.now();
  return db.reminders.filter((r) => r.userId === userId && !r.done && new Date(r.dueAt).getTime() <= now).length;
}

let timer = null;
/** Poll for due reminders and notify their owners (once each). */
export function startReminderScheduler(intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const r of db.reminders.filter((x) => !x.done && !x.notified && new Date(x.dueAt).getTime() <= now)) {
      const conv = r.conversationId ? db.conversations.get(r.conversationId) : null;
      notify(r.userId, {
        type: 'reminder',
        title: '⏰ ถึงเวลาตามลูกค้า',
        body: (conv?.customer?.name ? conv.customer.name + ' — ' : '') + (r.note || 'ติดตามลูกค้า'),
        conversationId: r.conversationId,
      });
      db.reminders.update(r.id, { notified: true });
      log.info(`reminder ${r.id} fired for ${r.userId}`);
    }
  }, intervalMs);
  timer.unref?.();
}
