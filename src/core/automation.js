import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { getAdapter } from '../channels/registry.js';
import { isAvailable } from './presence.js';
import { isEligibleForAssignment } from './rbac.js';
import { isOutsideBusinessHours } from './businessHours.js';
import { logger } from '../logger.js';

const log = logger('automation');

/**
 * Auto-reply / chatbot engine.
 *
 * Rule shape (collection `autoReplies`):
 *   { id, organizationId, channelAccountId|null (null = all accounts),
 *     type: 'welcome' | 'keyword' | 'away',
 *     keywords: [..]            // for type 'keyword'
 *     text, enabled }
 *
 * Triggers (evaluated on every inbound message):
 *   welcome → first message of a brand-new conversation
 *   keyword → inbound text contains any keyword
 *   away    → new conversation arrives while no agent is online
 */
export function rulesFor(organizationId, channelAccountId) {
  return db.autoReplies.filter(
    (r) => r.enabled !== false && r.organizationId === organizationId &&
      (!r.channelAccountId || r.channelAccountId === channelAccountId),
  );
}

// "Agent online" = an assignment-eligible agent who is available (not managers/
// owners), so the away message fires whenever no sales agent can pick up.
function anyAgentOnline(organizationId) {
  return db.users.all().some((u) =>
    u.organizationId === organizationId && u.status !== 'disabled' &&
    isEligibleForAssignment(u) && isAvailable(u));
}

/**
 * Run auto-replies for an inbound message. Fire-and-forget (async) so it never
 * blocks ingestion. Each reply is stored as an outbound "bot" message.
 */
export async function runAutoReplies({ account, conversation, text, isNew }) {
  try {
    const rules = rulesFor(account.organizationId, account.id);
    const toSend = [];

    if (isNew) {
      // "Away" fires outside business hours when configured; otherwise it falls
      // back to "no sales agent is online".
      const org = db.organizations.get(account.organizationId);
      const bh = org?.businessHours;
      const away = (bh && bh.enabled) ? isOutsideBusinessHours(bh) : !anyAgentOnline(account.organizationId);
      if (away) {
        const rule = rules.find((r) => r.type === 'away');
        if (rule) toSend.push(rule.text);
      }
      const welcome = rules.find((r) => r.type === 'welcome');
      if (welcome && !toSend.length) toSend.push(welcome.text);
    }

    const hay = (text || '').toLowerCase();
    for (const r of rules) {
      if (r.type === 'keyword' && (r.keywords || []).some((k) => hay.includes(k.toLowerCase()))) {
        toSend.push(r.text);
      }
    }

    for (const body of toSend) await sendBotMessage(account, conversation, body);
  } catch (e) {
    log.error(`auto-reply failed: ${e.message}`);
  }
}

/** Send an automated/broadcast outbound message and persist it. */
export async function sendBotMessage(account, conversation, text, senderName = '🤖 Auto-reply') {
  const adapter = getAdapter(conversation.channel);
  const externalMessageId = adapter ? await adapter.send(account, conversation, text, []) : null;
  const message = db.messages.insert({
    conversationId: conversation.id,
    direction: 'out',
    channel: conversation.channel,
    text,
    attachments: [],
    externalMessageId,
    senderName,
    auto: true,
    createdAt: new Date().toISOString(),
  });
  const updated = db.conversations.update(conversation.id, { lastMessageAt: message.createdAt });
  bus.emit('conversation:upserted', updated);
  bus.emit('message:created', { conversation: updated, message });
  return message;
}

/**
 * Broadcast a message to every conversation matching a filter.
 * filter: { channel?, channelAccountId?, tag?, grade? }
 */
export async function broadcast(user, text, filter = {}) {
  const convos = db.conversations.filter((c) => {
    if (c.organizationId !== user.organizationId) return false;
    if (filter.channel && c.channel !== filter.channel) return false;
    if (filter.channelAccountId && c.channelAccountId !== filter.channelAccountId) return false;
    if (filter.grade && c.grade !== filter.grade) return false;
    if (filter.tag && !(c.tags || []).includes(filter.tag)) return false;
    return true;
  });
  let sent = 0;
  for (const c of convos) {
    const account = db.channelAccounts.get(c.channelAccountId);
    if (!account) continue;
    await sendBotMessage(account, c, text, `📢 ${user.name}`);
    sent++;
  }
  log.info(`broadcast by ${user.name}: ${sent} recipients`);
  return { sent, matched: convos.length };
}

/** Count conversations a broadcast filter would reach (for the UI preview). */
export function broadcastAudience(organizationId, filter = {}) {
  return db.conversations.filter((c) => {
    if (c.organizationId !== organizationId) return false;
    if (filter.channel && c.channel !== filter.channel) return false;
    if (filter.channelAccountId && c.channelAccountId !== filter.channelAccountId) return false;
    if (filter.grade && c.grade !== filter.grade) return false;
    if (filter.tag && !(c.tags || []).includes(filter.tag)) return false;
    return true;
  }).length;
}
