import { WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { db } from '../store/db.js';
import { bus } from '../core/eventBus.js';
import { logger } from '../logger.js';

const log = logger('realtime');

/**
 * WebSocket push layer. Clients connect to /ws?userId=... and receive live
 * events. Notifications are delivered only to their target user; conversation
 * and message events are broadcast to all agents in the same organization (the
 * client decides whether the update is relevant to its current view).
 */
export function attachRealtime(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const { searchParams } = new URL(req.url, 'http://localhost');
    const userId = searchParams.get('userId');
    const user = userId ? db.users.get(userId) : null;
    if (!user) {
      ws.close(4001, 'unknown user');
      return;
    }
    ws.user = user;
    log.info(`connected: ${user.name}`);
    ws.send(JSON.stringify({ type: 'connected', user }));

    // Inbound client messages — currently just "typing" presence relay.
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'typing') {
        broadcastOrg(user.organizationId, {
          type: 'typing',
          conversationId: msg.conversationId,
          user: { id: user.id, name: user.name },
          isTyping: !!msg.isTyping,
        }, ws);
      }
    });
  });

  const broadcastOrg = (organizationId, payload, except = null) => {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client === except) continue;
      if (client.readyState === 1 && client.user?.organizationId === organizationId) {
        client.send(data);
      }
    }
  };

  const sendToUser = (userId, payload) => {
    const data = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === 1 && client.user?.id === userId) client.send(data);
    }
  };

  bus.on('conversation:upserted', (conversation) =>
    broadcastOrg(conversation.organizationId, { type: 'conversation:upserted', conversation }));

  bus.on('message:created', ({ conversation, message }) =>
    broadcastOrg(conversation.organizationId, { type: 'message:created', conversationId: conversation.id, message }));

  bus.on('user:presence', (user) =>
    broadcastOrg(user.organizationId, { type: 'user:presence', user: { id: user.id, presence: user.presence } }));

  bus.on('notification:created', (n) => sendToUser(n.userId, { type: 'notification:created', notification: n }));

  return wss;
}
