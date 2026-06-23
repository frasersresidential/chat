import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../store/db.js';
import { can, PERMISSIONS, ROLES, isEligibleForAssignment } from '../core/rbac.js';
import { verifyToken, signToken, verifyPassword, hashPassword } from '../core/auth.js';
import { setPresence } from '../core/presence.js';
import { listInbox, getThread, sendReply, markRead, setTags, setGrade, searchConversations, setStage, setStatus, setDealValue, pipelineConversations, STAGES } from '../core/conversations.js';
import { assign, transfer, ASSIGNMENT_TYPE } from '../core/routing.js';
import { teamTree } from '../core/teams.js';
import { listNotifications, markRead as markNotifRead } from '../core/notifications.js';
import { buildReport, exportConversationsCSV, exportAgentsCSV } from '../core/reports.js';
import { broadcast, broadcastAudience } from '../core/automation.js';
import { defaultBusinessHours, sanitizeBusinessHours, isWithinBusinessHours } from '../core/businessHours.js';
import { createReminder, listReminders, completeReminder, remindersForConversation } from '../core/reminders.js';
import { buildPendingSummary, sendDailyReport, defaultDailyReport } from '../core/dailyReport.js';
import { defaultSla } from '../core/sla.js';
import { handoverUserConversations } from '../core/handover.js';
import { CHANNEL_META, CHANNEL_TYPES } from '../channels/registry.js';
import { mountWebhooks } from './webhooks.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger('api');

// Where uploaded media (images/videos/files) is stored and served from.
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'application/pdf': '.pdf', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
};
const mediaType = (mime) =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';

/** Resolve the acting user from a Bearer JWT. */
function authMiddleware(req, res, next) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  const user = payload ? db.users.get(payload.sub) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (user.status === 'disabled') return res.status(403).json({ error: 'account disabled' });
  req.user = user;
  next();
}

/** Strip secrets before sending a user to the client. */
function publicUser(u) {
  if (!u) return u;
  const { passwordHash, ...safe } = u;
  return safe;
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
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // ── Public auth (no token required) ───────────────────────────────────────
  const auth = express.Router();
  auth.post('/login', (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = db.users.find((u) => (u.email || '').toLowerCase() === email);
    if (!user || !verifyPassword(req.body.password, user.passwordHash)) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    if (user.status === 'disabled') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ' });
    res.json({ token: signToken({ sub: user.id }), user: publicUser(user) });
  });
  app.use('/api/auth', auth);

  const api = express.Router();
  api.use(authMiddleware);

  // Owner/Admin can mint a token to act as another user (secured impersonation).
  api.post('/auth/impersonate', requirePerm(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const target = db.users.get(req.body.userId);
    if (!target || target.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json({ token: signToken({ sub: target.id }), user: publicUser(target) });
  });

  // ── Identity & reference data ─────────────────────────────────────────────
  api.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user), permissions: ROLES[req.user.role]?.permissions || [] });
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
    res.json(db.users.filter((u) => u.organizationId === req.user.organizationId).map((u) => ({
      ...publicUser(u),
      activeChats: db.conversations.filter((c) => c.assignedUserId === u.id && c.status !== 'resolved').length,
    })));
  });

  api.post('/users', requirePerm(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const { name, email, role, password } = req.body;
    if (!name || !ROLES[role]) return res.status(400).json({ error: 'name and valid role required' });
    const user = db.users.insert({
      organizationId: req.user.organizationId,
      name, email: email || '', role, presence: 'offline', status: 'invited',
      passwordHash: hashPassword(password || 'demo1234'),
    });
    res.status(201).json(publicUser(user));
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
    const wasDisabled = target.status === 'disabled';
    const updated = db.users.update(target.id, patch);
    // Offboarding: when an agent is disabled, redistribute their open chats.
    let handover = null;
    if (patch.status === 'disabled' && !wasDisabled) {
      handover = handoverUserConversations(target.id, { byUserId: req.user.id });
    }
    res.json({ ...publicUser(updated), handover });
  });

  // Manually redistribute a user's open conversations (resign / move team).
  api.post('/users/:id/handover', requirePerm(PERMISSIONS.MANAGE_USERS), (req, res) => {
    const target = db.users.get(req.params.id);
    if (!target || target.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json(handoverUserConversations(target.id, {
      toUserId: req.body.toUserId || null,
      toTeamId: req.body.toTeamId || null,
      byUserId: req.user.id,
    }));
  });

  api.put('/me/presence', (req, res) => {
    try {
      res.json(publicUser(setPresence(req.user.id, req.body.status)));
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
  const parseRange = (q) => (q.range && q.range !== 'all' ? Number(q.range) || null : null);

  api.get('/reports', requirePerm(PERMISSIONS.VIEW_ANALYTICS), (req, res) => {
    res.json(buildReport(req.user.organizationId, { rangeDays: parseRange(req.query) }));
  });

  // Pending-chats summary — visible to anyone who can see team/all conversations
  // (supervisors included), so it isn't gated behind full analytics.
  const canSeeTeam = (req, res, next) =>
    (can(req.user, PERMISSIONS.VIEW_TEAM_CONVERSATIONS) || can(req.user, PERMISSIONS.VIEW_ALL_CONVERSATIONS))
      ? next() : res.status(403).json({ error: 'forbidden' });

  api.get('/reports/pending', canSeeTeam, (req, res) => {
    res.json(buildPendingSummary(req.user.organizationId));
  });

  api.post('/reports/daily/send', requirePerm(PERMISSIONS.TAKEOVER), (req, res) => {
    res.json(sendDailyReport(req.user.organizationId));
  });

  api.get('/daily-report', canSeeTeam, (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    res.json(org?.dailyReport || defaultDailyReport());
  });
  api.put('/daily-report', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    const cfg = {
      enabled: !!req.body.enabled,
      time: /^\d{2}:\d{2}$/.test(req.body.time) ? req.body.time : (org?.dailyReport?.time || '18:00'),
    };
    db.organizations.update(org.id, { dailyReport: cfg });
    res.json(cfg);
  });

  api.get('/reports/export', requirePerm(PERMISSIONS.VIEW_ANALYTICS), (req, res) => {
    const opts = { rangeDays: parseRange(req.query) };
    const isAgents = req.query.type === 'agents';
    const csv = isAgents
      ? exportAgentsCSV(req.user.organizationId, opts)
      : exportConversationsCSV(req.user.organizationId, opts);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="omnichat-${isAgents ? 'agents' : 'conversations'}.csv"`);
    res.send(csv);
  });

  // ── Automation: auto-replies / chatbot ────────────────────────────────────
  api.get('/auto-replies', (req, res) => {
    res.json(db.autoReplies.filter((r) => r.organizationId === req.user.organizationId));
  });
  api.post('/auto-replies', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const { type, text, keywords, channelAccountId } = req.body;
    if (!['welcome', 'keyword', 'away'].includes(type) || !String(text || '').trim()) {
      return res.status(400).json({ error: 'valid type and text required' });
    }
    res.status(201).json(db.autoReplies.insert({
      organizationId: req.user.organizationId,
      type, text: String(text).trim(),
      keywords: Array.isArray(keywords) ? keywords : [],
      channelAccountId: channelAccountId || null,
      enabled: true,
    }));
  });
  api.put('/auto-replies/:id', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const r = db.autoReplies.get(req.params.id);
    if (!r || r.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const patch = {};
    for (const k of ['text', 'enabled', 'channelAccountId']) if (req.body[k] !== undefined) patch[k] = req.body[k];
    if (Array.isArray(req.body.keywords)) patch.keywords = req.body.keywords;
    res.json(db.autoReplies.update(r.id, patch));
  });
  api.delete('/auto-replies/:id', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    db.autoReplies.remove(req.params.id);
    res.status(204).end();
  });

  // ── Business hours ────────────────────────────────────────────────────────
  // ── SLA (real-time pending alerts) ────────────────────────────────────────
  api.get('/sla', (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    res.json(org?.sla || defaultSla());
  });
  api.put('/sla', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    const cur = org?.sla || defaultSla();
    const minutes = Number(req.body.minutes);
    const cfg = {
      enabled: !!req.body.enabled,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : cur.minutes,
      escalate: req.body.escalate !== undefined ? !!req.body.escalate : cur.escalate,
      reassign: req.body.reassign !== undefined ? !!req.body.reassign : (cur.reassign !== false),
    };
    db.organizations.update(org.id, { sla: cfg });
    res.json(cfg);
  });

  api.get('/business-hours', (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    const bh = org?.businessHours || defaultBusinessHours();
    res.json({ ...bh, openNow: isWithinBusinessHours(bh) });
  });
  api.put('/business-hours', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    const bh = sanitizeBusinessHours(req.body, org?.businessHours || defaultBusinessHours());
    db.organizations.update(org.id, { businessHours: bh });
    res.json({ ...bh, openNow: isWithinBusinessHours(bh) });
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────
  api.get('/broadcast/audience', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    res.json({ count: broadcastAudience(req.user.organizationId, req.query) });
  });
  api.post('/broadcast', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      res.json(await broadcast(req.user, text, req.body.filter || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ── Projects (ad-set code → name + sales team) ────────────────────────────
  api.get('/projects', (req, res) => {
    res.json(db.projects.filter((p) => p.organizationId === req.user.organizationId));
  });
  api.post('/projects', requirePerm(PERMISSIONS.MANAGE_ROUTING), (req, res) => {
    const name = String(req.body.name || '').trim();
    const keywords = Array.isArray(req.body.keywords) ? req.body.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
    if (!name || !keywords.length) return res.status(400).json({ error: 'name and at least one keyword required' });
    if (req.body.teamId && !db.teams.get(req.body.teamId)) return res.status(400).json({ error: 'invalid teamId' });
    res.status(201).json(db.projects.insert({
      organizationId: req.user.organizationId, name, code: keywords[0], keywords, teamId: req.body.teamId || null,
    }));
  });
  api.put('/projects/:id', requirePerm(PERMISSIONS.MANAGE_ROUTING), (req, res) => {
    const p = db.projects.get(req.params.id);
    if (!p || p.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.name) patch.name = String(req.body.name).trim();
    if (Array.isArray(req.body.keywords)) { patch.keywords = req.body.keywords.map((k) => String(k).trim()).filter(Boolean); patch.code = patch.keywords[0]; }
    if (req.body.teamId !== undefined) patch.teamId = req.body.teamId || null;
    res.json(db.projects.update(p.id, patch));
  });
  api.delete('/projects/:id', requirePerm(PERMISSIONS.MANAGE_ROUTING), (req, res) => {
    db.projects.remove(req.params.id);
    res.status(204).end();
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
    res.json({ ...thread, conversation: decorateConversation(thread.conversation), reminders: remindersForConversation(thread.conversation.id) });
  });

  api.post('/conversations/:id/read', (req, res) => {
    res.json(markRead(req.params.id));
  });

  // ── Follow-up reminders / tasks ───────────────────────────────────────────
  api.get('/reminders', (req, res) => {
    const enrich = (r) => ({ ...r, conversation: r.conversationId ? decorateConversation(db.conversations.get(r.conversationId)) : null });
    res.json(listReminders(req.user, req.query.scope || 'mine').map(enrich));
  });

  api.post('/conversations/:id/reminders', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    try {
      const r = createReminder({
        organizationId: req.user.organizationId,
        conversationId: conv.id,
        userId: db.users.get(req.body.userId) ? req.body.userId : (conv.assignedUserId || req.user.id),
        createdBy: req.user.id,
        dueAt: req.body.dueAt,
        note: req.body.note,
      });
      res.status(201).json(r);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  api.post('/reminders/:id/complete', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const r = db.reminders.get(req.params.id);
    if (!r || r.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json(completeReminder(r.id));
  });

  api.delete('/reminders/:id', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const r = db.reminders.get(req.params.id);
    if (!r || r.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    db.reminders.remove(r.id);
    res.status(204).end();
  });

  api.post('/conversations/:id/reply', requirePerm(PERMISSIONS.REPLY), async (req, res) => {
    try {
      const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
      const msg = await sendReply(req.params.id, req.user, String(req.body.text || '').trim(), attachments);
      res.status(201).json(msg);
    } catch (e) {
      log.error(e.message);
      res.status(400).json({ error: e.message });
    }
  });

  // ── Media upload (images / video / files) ─────────────────────────────────
  // Raw body upload — keeps the project dependency-free (no multer). The client
  // sends the file bytes with its content-type and an X-File-Name header.
  api.post('/uploads', requirePerm(PERMISSIONS.REPLY), express.raw({ type: '*/*', limit: '26214400' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'empty upload' });
    }
    const mime = (req.header('content-type') || 'application/octet-stream').split(';')[0];
    let origName = 'file';
    try { origName = decodeURIComponent(req.header('x-file-name') || 'file'); } catch { /* keep default */ }
    const ext = MIME_EXT[mime] || path.extname(origName) || '.bin';
    const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), req.body);
    res.status(201).json({ url: `/uploads/${fileName}`, type: mediaType(mime), mime, name: origName });
  });

  // ── Canned / quick replies ────────────────────────────────────────────────
  api.get('/canned-responses', (req, res) => {
    res.json(db.cannedResponses.filter((c) => c.organizationId === req.user.organizationId));
  });
  api.post('/canned-responses', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const title = String(req.body.title || '').trim();
    const text = String(req.body.text || '').trim();
    if (!title || !text) return res.status(400).json({ error: 'title and text required' });
    res.status(201).json(db.cannedResponses.insert({
      organizationId: req.user.organizationId, title, text,
      shortcut: String(req.body.shortcut || '').trim(), createdBy: req.user.id,
    }));
  });
  api.delete('/canned-responses/:id', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const c = db.cannedResponses.get(req.params.id);
    if (!c || c.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    db.cannedResponses.remove(c.id);
    res.status(204).end();
  });

  api.put('/conversations/:id/tags', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json(decorateConversation(setTags(conv.id, req.body.tags)));
  });

  api.put('/conversations/:id/grade', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    try {
      res.json(decorateConversation(setGrade(conv.id, req.body.grade)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get('/search', (req, res) => {
    const results = searchConversations(req.user, req.query.q)
      .map((r) => ({ snippet: r.snippet, conversation: decorateConversation(r.conversation) }));
    res.json(results);
  });

  // ── Sales pipeline (Kanban) + resolve ─────────────────────────────────────
  api.get('/pipeline', (req, res) => {
    res.json({ stages: STAGES, conversations: pipelineConversations(req.user).map(decorateConversation) });
  });

  api.put('/conversations/:id/stage', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    try { res.json(decorateConversation(setStage(conv.id, req.body.stage))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  api.post('/conversations/:id/status', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    try { res.json(decorateConversation(setStatus(conv.id, req.body.status))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  api.put('/conversations/:id/deal-value', requirePerm(PERMISSIONS.REPLY), (req, res) => {
    const conv = db.conversations.get(req.params.id);
    if (!conv || conv.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    try { res.json(decorateConversation(setDealValue(conv.id, req.body.value))); }
    catch (e) { res.status(400).json({ error: e.message }); }
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
  if (!c) return null;
  const owner = c.assignedUserId ? db.users.get(c.assignedUserId) : null;
  const account = db.channelAccounts.get(c.channelAccountId);
  const pending = remindersForConversation(c.id).find((r) => !r.done);
  return {
    ...c,
    assignedUserName: owner?.name || null,
    accountName: account?.accountName || null,
    channelLabel: CHANNEL_META[c.channel]?.label || c.channel,
    reminderAt: pending?.dueAt || null,
    waitingSince: c.waitingSince || null,
    slaBreachedAt: c.slaBreachedAt || null,
  };
}

/** Never leak secrets to the client — show only which fields are configured. */
function redactCredential(cred = {}) {
  return Object.fromEntries(Object.keys(cred).map((k) => [k, cred[k] ? '••••configured' : '']));
}
