import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../store/db.js';
import { can, PERMISSIONS, ROLES, isEligibleForAssignment } from '../core/rbac.js';
import { setPresence } from '../core/presence.js';
import { listInbox, getThread, sendReply, markRead } from '../core/conversations.js';
import { assign, transfer, ASSIGNMENT_TYPE } from '../core/routing.js';
import { teamTree } from '../core/teams.js';
import { listNotifications, markRead as markNotifRead } from '../core/notifications.js';
import { buildReport } from '../core/reports.js';
import { CHANNEL_META, CHANNEL_TYPES } from '../channels/registry.js';
import { mountWebhooks } from './webhooks.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger('api');

/** Resolve the acting user from the X-User-Id header (demo-grade auth). */
function authMiddleware(req, res, next) {
  const userId = req.header('x-user-id');
  const user = userId ? db.users.get(userId) : null;
  if (!user) return res.status(401).json({ error: 'unknown or missing user (set X-User-Id)' });
  req.user = user;
  next();
}

const requirePerm = (perm) => (req, res, next) => {
  if (!can(req.user, perm)) return res.status(403).json({ error: `missing permission: ${perm}` });
  next();
};

export function createApp() {
  const app = express();

  // Webhooks need the raw body for signature checks → mount before json parser.
  mountWebhooks(app);

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  const api = express.Router();
  api.use(authMiddleware);

  // ── Identity & reference data ─────────────────────────────────────────────
  api.get('/me', (req, res) => {
    res.json({ user: req.user, permissions: ROLES[req.user.role]?.permissions || [] });
  });

  api.get('/meta', (_req, res) => {
    res.json({
      channels: CHANNEL_META,
      channelTypes: CHANNEL_TYPES,
      roles: Object.fromEntries(
        Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, eligibleForAssignment: v.eligibleForAssignment }]),
      ),
      assignmentTypes: ASSIGNMENT_TYPE,
    });
  });

  api.get('/users', (req, res) => {
    res.json(db.users.filter((u) => u.organizationId === req.user.organizationId));
  });

  api.post('/users', requirePerm(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const { name, email, role } = req.body;
    if (!name || !ROLES[role]) return res.status(400).json({ error: 'name and valid role required' });
    const user = db.users.insert({
      organizationId: req.user.organizationId,
      name, email: email || '', role, presence: 'offline', status: 'invited',
    });
    res.status(201).json(user);
  });

  // Edit a user's role / status / name (and revoke = status:disabled).
  api.put('/users/:id', requirePerm(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const target = db.users.get(req.params.id);
    if (!target || target.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'not found' });
    }
    const patch = {};
    if (req.body.name) patch.name = req.body.name;
    if (req.body.role) {
      if (!ROLES[req.body.role]) return res.status(400).json({ error: 'invalid role' });
      patch.role = req.body.role;
    }
    if (req.body.status && ['active', 'invited', 'disabled'].includes(req.body.status)) {
      patch.status = req.body.status;
    }
    res.json(db.users.update(target.id, patch));
  });

  api.put('/me/presence', (req, res) => {
    try {
      res.json(setPresence(req.user.id, req.body.status));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Teams ─────────────────────────────────────────────────────────────────
  api.get('/teams', (req, res) => res.json(teamTree(req.user.organizationId)));

  api.post('/teams', requirePerm(PERMISSIONS.MANAGE_TEAMS), (req, res) => {
    const { name, parentId } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    res.status(201).json(db.teams.insert({
      organizationId: req.user.organizationId, name, parentId: parentId || null,
    }));
  });

  api.post('/teams/:id/members', requirePerm(PERMISSIONS.MANAGE_TEAMS), (req, res) => {
    const { userId, role } = req.body;
    if (!db.teams.get(req.params.id) || !db.users.get(userId)) {
      return res.status(400).json({ error: 'invalid team or user' });
    }
    res.status(201).json(db.teamMembers.insert({ teamId: req.params.id, userId, role: role || 'agent' }));
  });

  // ── Channel accounts ──────────────────────────────────────────────────────
  api.get('/channel-accounts', (req, res) => {
    const accounts = db.channelAccounts
      .filter((c) => c.organizationId === req.user.organizationId)
      .map((c) => ({ ...c, credential: redactCredential(c.credential) }));
    res.json(accounts);
  });

  api.post('/channel-accounts', requirePerm(PERMISSIONS.MANAGE_CHANNELS), (req, res) => {
    const { channelType, accountName, accountId, credential } = req.body;
    if (!CHANNEL_TYPES.includes(channelType) || !accountName) {
      return res.status(400).json({ error: 'valid channelType and accountName required' });
    }
    const acc = db.channelAccounts.insert({
      organizationId: req.user.organizationId,
      channelType, accountName, accountId: accountId || '',
      credential: credential || {}, webhookStatus: 'pending', status: 'active',
    });
    res.status(201).json({ ...acc, credential: redactCredential(acc.credential) });
  });

  api.put('/channel-accounts/:id', requirePerm(PERMISSIONS.MANAGE_CHANNELS), (req, res) => {
    const acc = db.channelAccounts.get(req.params.id);
    if (!acc || acc.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const patch = {};
    for (const k of ['accountName', 'accountId', 'status', 'webhookStatus']) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }
    if (req.body.credential) patch.credential = { ...acc.credential, ...req.body.credential };
    const updated = db.channelAccounts.update(acc.id, patch);
    res.json({ ...updated, credential: redactCredential(updated.credential) });
  });

  api.delete('/channel-accounts/:id', requirePerm(PERMISSIONS.MANAGE_CHANNELS), (req, res) => {
    const acc = db.channelAccounts.get(req.params.id);
    if (!acc || acc.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    // Drop routing rules that reference this account so we don't orphan them.
    db.routingRules.filter((r) => r.channelAccountId === acc.id).forEach((r) => db.routingRules.remove(r.id));
    db.channelAccounts.remove(acc.id);
    res.status(204).end();
  });

  // ── Reports / analytics ───────────────────────────────────────────────────
  api.get('/reports', requirePerm(PERMISSIONS.VIEW_ANALYTICS), (req, res) => {
    res.json(buildReport(req.user.organizationId));
  });

  // ── Routing rules ─────────────────────────────────────────────────────────
  api.get('/routing-rules', (req, res) => {
    const orgAccounts = new Set(
      db.channelAccounts.filter((c) => c.organizationId === req.user.organizationId).map((c) => c.id),
    );
    res.json(db.routingRules.filter((r) => orgAccounts.has(r.channelAccountId)));
  });

  api.post('/routing-rules', requirePerm(PERMISSIONS.MANAGE_ROUTING), (req, res) => {
    const { channelAccountId, teamId, routingType, priority, condition, assignToRole } = req.body;
    if (!db.channelAccounts.get(channelAccountId) || !db.teams.get(teamId)) {
      return res.status(400).json({ error: 'invalid channelAccountId or teamId' });
    }
    res.status(201).json(db.routingRules.insert({
      channelAccountId, teamId,
      routingType: routingType || 'round_robin',
      priority: priority ?? 100,
      condition: condition || { type: 'always' },
      assignToRole: assignToRole || null,
    }));
  });

  api.delete('/routing-rules/:id', requirePerm(PERMISSIONS.MANAGE_ROUTING), (req, res) => {
    db.routingRules.remove(req.params.id);
    res.status(204).end();
  });

  // ── Inbox & conversations ─────────────────────────────────────────────────
  api.get('/inbox', (req, res) => {
    const mode = req.query.mode || 'my';
    res.json(listInbox(req.user, mode).map(decorateConversation));
  });

  api.get('/conversations/:id', (req, res) => {
    const thread = getThread(req.params.id);
    if (!thread || thread.conversation.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ ...thread, conversation: decorateConversation(thread.conversation) });
  });

  api.post('/conversations/:id/read', (req, res) => {
    res.json(markRead(req.params.id));
  });

  api.post('/conversations/:id/reply', requirePerm(PERMISSIONS.REPLY), async (req, res) => {
    try {
      const msg = await sendReply(req.params.id, req.user, String(req.body.text || '').trim());
      res.status(201).json(msg);
    } catch (e) {
      log.error(e.message);
      res.status(400).json({ error: e.message });
    }
  });

  api.post('/conversations/:id/assign', requirePerm(PERMISSIONS.ASSIGN), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    const target = db.users.get(req.body.userId);
    if (!conv || !target) return res.status(400).json({ error: 'invalid conversation or user' });
    res.json(assign(conv, target.id, ASSIGNMENT_TYPE.MANUAL));
  });

  api.post('/conversations/:id/takeover', requirePerm(PERMISSIONS.TAKEOVER), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'not found' });
    res.json(transfer(conv, req.user.id, req.user.id));
  });

  api.post('/conversations/:id/transfer', requirePerm(PERMISSIONS.TRANSFER), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    const target = db.users.get(req.body.userId);
    if (!conv || !target) return res.status(400).json({ error: 'invalid conversation or user' });
    res.json(transfer(conv, target.id, req.user.id));
  });

  // ── Notifications ─────────────────────────────────────────────────────────
  api.get('/notifications', (req, res) => res.json(listNotifications(req.user.id)));
  api.post('/notifications/:id/read', (req, res) => res.json(markNotifRead(req.params.id)));

  app.use('/api', api);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  return app;
}

/** Attach owner name + channel label so the UI doesn't need extra round-trips. */
function decorateConversation(c) {
  const owner = c.assignedUserId ? db.users.get(c.assignedUserId) : null;
  const account = db.channelAccounts.get(c.channelAccountId);
  return {
    ...c,
    assignedUserName: owner?.name || null,
    accountName: account?.accountName || null,
    channelLabel: CHANNEL_META[c.channel]?.label || c.channel,
  };
}

/** Never leak secrets to the client — show only which fields are configured. */
function redactCredential(cred = {}) {
  return Object.fromEntries(Object.keys(cred).map((k) => [k, cred[k] ? '••••configured' : '']));
}
