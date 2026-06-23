import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { getAdapter } from '../channels/registry.js';
import { routeConversation, assignmentHistory } from './routing.js';
import { can, PERMISSIONS } from './rbac.js';
import { teamsForUser } from './teams.js';
import { runAutoReplies } from './automation.js';
import { enrichAdReferralAsync } from './ads.js';
import { logger } from '../logger.js';

const log = logger('conversations');

/**
 * Ingest a normalized inbound message on a given ChannelAccount:
 *   find/create conversation → store message → route if new → emit events.
 */
export function ingestInbound(account, inbound) {
  let conversation = db.conversations.find(
    (c) => c.channelAccountId === account.id && c.participantId === inbound.participantId,
  );

  const isNew = !conversation;
  if (isNew) {
    conversation = db.conversations.insert({
      organizationId: account.organizationId,
      channelAccountId: account.id,
      channel: account.channelType,
      participantId: inbound.participantId,
      customer: {
        name: inbound.participantName || 'Customer',
        avatar: inbound.avatar || null,
        vip: !!inbound.vip,
      },
      assignedUserId: null,
      teamId: null,
      status: 'open',
      unread: 0,
      // Ad attribution for chats started from a Click-to-Messenger ad.
      adReferral: inbound.referral || null,
      lastMessageAt: inbound.timestamp,
    });
    log.info(`new conversation ${conversation.id} on ${account.accountName}`
      + (inbound.referral ? ` [from ad ${inbound.referral.adId || inbound.referral.ref || ''}]` : ''));
  }

  const message = db.messages.insert({
    conversationId: conversation.id,
    direction: 'in',
    channel: account.channelType,
    text: inbound.text,
    attachments: inbound.attachments || [],
    externalMessageId: inbound.externalMessageId,
    senderName: conversation.customer.name,
    createdAt: inbound.timestamp,
  });

  conversation = db.conversations.update(conversation.id, {
    lastMessageAt: inbound.timestamp,
    unread: (conversation.unread || 0) + 1,
    status: 'open',
  });

  // Only route brand-new conversations (don't reassign an active thread).
  if (isNew) {
    const r = conversation.adReferral;
    // Real Meta ads only give us ad_id — the Ad set name (used by project
    // routing rules) must be fetched from the Graph API first. In that case
    // defer routing until enrichment completes; otherwise route immediately.
    const needsAdsetEnrich = !!(r && r.adId && !r.adsetName && account?.credential?.accessToken);
    if (needsAdsetEnrich) {
      enrichThenRoute(account, conversation.id, inbound.text);
    } else {
      if (r) enrichAdReferralAsync(account, conversation); // best-effort name fill (non-blocking)
      routeConversation(conversation, { text: inbound.text });
      conversation = db.conversations.get(conversation.id);
    }
  }

  bus.emit('conversation:upserted', conversation);
  bus.emit('message:created', { conversation, message });

  // Fire auto-replies asynchronously so ingestion stays fast.
  runAutoReplies({ account, conversation, text: inbound.text, isNew });
  return { conversation, message };
}

/** Enrich a Meta-ads conversation (resolve Ad set name) then route it. */
async function enrichThenRoute(account, conversationId, text) {
  await enrichAdReferralAsync(account, db.conversations.get(conversationId));
  const conv = db.conversations.get(conversationId);
  if (!conv) return;
  routeConversation(conv, { text });
  bus.emit('conversation:upserted', db.conversations.get(conversationId));
}

/** Agent/manager sends an outbound reply through the originating channel. */
export async function sendReply(conversationId, user, text, attachments = []) {
  const conversation = db.conversations.get(conversationId);
  if (!conversation) throw new Error('conversation not found');
  if (!text && (!attachments || attachments.length === 0)) {
    throw new Error('message text or an attachment is required');
  }

  const account = db.channelAccounts.get(conversation.channelAccountId);
  const adapter = getAdapter(conversation.channel);
  if (!adapter) throw new Error(`no adapter for ${conversation.channel}`);

  const externalMessageId = await adapter.send(account, conversation, text, attachments);

  const message = db.messages.insert({
    conversationId,
    direction: 'out',
    channel: conversation.channel,
    text,
    attachments: attachments || [],
    externalMessageId,
    senderUserId: user.id,
    senderName: user.name,
    createdAt: new Date().toISOString(),
  });

  const updated = db.conversations.update(conversationId, {
    lastMessageAt: message.createdAt,
    unread: 0,
  });

  bus.emit('conversation:upserted', updated);
  bus.emit('message:created', { conversation: updated, message });
  return message;
}

export function markRead(conversationId) {
  const updated = db.conversations.update(conversationId, { unread: 0 });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

export const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Set the lead grade (A–F) used for reporting; pass null/'' to clear. */
export function setGrade(conversationId, grade) {
  if (grade && !GRADES.includes(grade)) throw new Error('invalid grade');
  const updated = db.conversations.update(conversationId, { grade: grade || null });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

/** Replace the conversation's tag list (deduped, trimmed, capped). */
export function setTags(conversationId, tags) {
  const clean = Array.from(new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))).slice(0, 20);
  const updated = db.conversations.update(conversationId, { tags: clean });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

/**
 * Search visible conversations by customer name, participant id, tag, grade or
 * message text. Respects the same RBAC scope as the inbox.
 */
export function searchConversations(user, q) {
  const term = String(q || '').toLowerCase().trim();
  if (!term) return [];
  const canSeeAll = can(user, PERMISSIONS.VIEW_ALL_CONVERSATIONS);
  const myTeams = new Set(teamsForUser(user.id));
  const teamMemberIds = new Set(db.teamMembers.filter((m) => myTeams.has(m.teamId)).map((m) => m.userId));
  const visible = (c) =>
    canSeeAll || c.assignedUserId === user.id || (c.assignedUserId && teamMemberIds.has(c.assignedUserId));

  const results = [];
  for (const c of db.conversations.filter((c) => c.organizationId === user.organizationId && visible(c))) {
    const hay = [c.customer?.name, c.participantId, (c.tags || []).join(' '), c.grade]
      .filter(Boolean).join(' ').toLowerCase();
    let snippet = null;
    let matched = hay.includes(term);
    if (!matched) {
      const msg = db.messages.filter((m) => m.conversationId === c.id).find((m) => (m.text || '').toLowerCase().includes(term));
      if (msg) { matched = true; snippet = msg.text; }
    }
    if (matched) results.push({ conversation: c, snippet });
  }
  return results
    .sort((a, b) => new Date(b.conversation.lastMessageAt) - new Date(a.conversation.lastMessageAt))
    .slice(0, 50);
}

// ── Sales pipeline + resolve ─────────────────────────────────────────────────
export const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

/** Move a conversation along the sales pipeline. */
export function setStage(conversationId, stage) {
  if (!STAGES.includes(stage)) throw new Error('invalid stage');
  const updated = db.conversations.update(conversationId, { stage });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

/** Resolve (close) or reopen a conversation. */
export function setStatus(conversationId, status) {
  if (!['open', 'resolved'].includes(status)) throw new Error('invalid status');
  const updated = db.conversations.update(conversationId, {
    status,
    resolvedAt: status === 'resolved' ? new Date().toISOString() : null,
  });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

/** Set the deal value (revenue) for ROI reporting; null/0 to clear. */
export function setDealValue(conversationId, value) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) throw new Error('invalid deal value');
  const updated = db.conversations.update(conversationId, { dealValue: n || null });
  if (updated) bus.emit('conversation:upserted', updated);
  return updated;
}

/** All conversations visible to the user (any status) for the Kanban board. */
export function pipelineConversations(user) {
  const canSeeAll = can(user, PERMISSIONS.VIEW_ALL_CONVERSATIONS);
  const myTeams = new Set(teamsForUser(user.id));
  const teamMemberIds = new Set(db.teamMembers.filter((m) => myTeams.has(m.teamId)).map((m) => m.userId));
  return db.conversations
    .filter((c) => c.organizationId === user.organizationId &&
      (canSeeAll || c.assignedUserId === user.id || (c.assignedUserId && teamMemberIds.has(c.assignedUserId))))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

export function getThread(conversationId) {
  const conversation = db.conversations.get(conversationId);
  if (!conversation) return null;
  return {
    conversation,
    messages: db.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    assignments: assignmentHistory(conversationId),
  };
}

/**
 * Inbox visibility. Combines RBAC scope with the requested view mode:
 *   my         → conversations owned by the user
 *   team       → conversations owned by anyone on the user's teams
 *   unassigned → open conversations with no owner (within scope)
 *   all        → everything in the org (managers/admins/owners/viewers only)
 */
export function listInbox(user, mode = 'my') {
  const orgConvos = db.conversations
    .filter((c) => c.organizationId === user.organizationId && c.status !== 'resolved')
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  const canSeeAll =
    can(user, PERMISSIONS.VIEW_ALL_CONVERSATIONS);
  const myTeams = new Set(teamsForUser(user.id));
  const teamMemberIds = new Set(
    db.teamMembers.filter((m) => myTeams.has(m.teamId)).map((m) => m.userId),
  );

  switch (mode) {
    case 'my':
      return orgConvos.filter((c) => c.assignedUserId === user.id);
    case 'unassigned':
      return orgConvos.filter(
        (c) => !c.assignedUserId && (canSeeAll || c.teamId === null || myTeams.has(c.teamId)),
      );
    case 'team':
      return orgConvos.filter(
        (c) => c.assignedUserId && teamMemberIds.has(c.assignedUserId),
      );
    case 'all':
    default:
      if (canSeeAll) return orgConvos;
      // Fall back to "my" for users without all-conversations scope.
      return orgConvos.filter((c) => c.assignedUserId === user.id);
  }
}
