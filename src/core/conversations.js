import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { getAdapter } from '../channels/registry.js';
import { routeConversation, assignmentHistory } from './routing.js';
import { can, PERMISSIONS } from './rbac.js';
import { teamsForUser } from './teams.js';
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
      lastMessageAt: inbound.timestamp,
    });
    log.info(`new conversation ${conversation.id} on ${account.accountName}`);
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
    routeConversation(conversation, { text: inbound.text });
    conversation = db.conversations.get(conversation.id);
  }

  bus.emit('conversation:upserted', conversation);
  bus.emit('message:created', { conversation, message });
  return { conversation, message };
}

/** Agent/manager sends an outbound reply through the originating channel. */
export async function sendReply(conversationId, user, text) {
  const conversation = db.conversations.get(conversationId);
  if (!conversation) throw new Error('conversation not found');

  const account = db.channelAccounts.get(conversation.channelAccountId);
  const adapter = getAdapter(conversation.channel);
  if (!adapter) throw new Error(`no adapter for ${conversation.channel}`);

  const externalMessageId = await adapter.send(account, conversation, text);

  const message = db.messages.insert({
    conversationId,
    direction: 'out',
    channel: conversation.channel,
    text,
    attachments: [],
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
    .filter((c) => c.organizationId === user.organizationId)
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
