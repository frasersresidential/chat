import { db } from '../store/db.js';
import { roleDef } from './rbac.js';

/**
 * Analytics for an organization. Computed on demand from the document store —
 * fine for a single node; precompute/materialize when you outgrow it.
 *
 * Returns conversation totals, per-channel and per-agent breakdowns, first
 * response time, daily volume (last 7 days) and assignment-type distribution.
 */
export function buildReport(organizationId, { days = 7 } = {}) {
  const conversations = db.conversations.filter((c) => c.organizationId === organizationId);
  const convIds = new Set(conversations.map((c) => c.id));
  const messages = db.messages.filter((m) => convIds.has(m.conversationId));
  const assignments = db.assignments.filter((a) => convIds.has(a.conversationId));
  const users = db.users.filter((u) => u.organizationId === organizationId);
  const accounts = db.channelAccounts.filter((c) => c.organizationId === organizationId);

  // ── Conversation totals ──────────────────────────────────────────────────
  const totals = {
    conversations: conversations.length,
    open: conversations.filter((c) => c.status !== 'closed').length,
    closed: conversations.filter((c) => c.status === 'closed').length,
    unassigned: conversations.filter((c) => !c.assignedUserId).length,
    vip: conversations.filter((c) => c.customer?.vip).length,
    messages: messages.length,
    activeChannels: accounts.filter((a) => a.status === 'active').length,
    agentsOnline: users.filter((u) => u.presence === 'online').length,
  };

  // ── By channel ───────────────────────────────────────────────────────────
  const byChannel = {};
  for (const c of conversations) byChannel[c.channel] = (byChannel[c.channel] || 0) + 1;

  // ── By lead grade (A–F) ──────────────────────────────────────────────────
  const byGrade = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, ungraded: 0 };
  for (const c of conversations) byGrade[c.grade || 'ungraded'] += 1;

  // ── Sales pipeline funnel ────────────────────────────────────────────────
  const byStage = { new: 0, contacted: 0, qualified: 0, proposal: 0, won: 0, lost: 0 };
  for (const c of conversations) byStage[c.stage || 'new'] = (byStage[c.stage || 'new'] || 0) + 1;

  // ── First response time (inbound → first agent reply) ────────────────────
  const msgsByConv = new Map();
  for (const m of messages) {
    if (!msgsByConv.has(m.conversationId)) msgsByConv.set(m.conversationId, []);
    msgsByConv.get(m.conversationId).push(m);
  }
  const responseMinutes = [];
  for (const list of msgsByConv.values()) {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const firstIn = list.find((m) => m.direction === 'in');
    const firstOut = list.find((m) => m.direction === 'out' && new Date(m.createdAt) >= new Date(firstIn?.createdAt || 0));
    if (firstIn && firstOut) {
      responseMinutes.push((new Date(firstOut.createdAt) - new Date(firstIn.createdAt)) / 60000);
    }
  }
  const avgFirstResponseMin = responseMinutes.length
    ? +(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length).toFixed(1)
    : null;

  // ── Per agent performance ────────────────────────────────────────────────
  const byAgent = users
    .filter((u) => roleDef(u.role).eligibleForAssignment || conversations.some((c) => c.assignedUserId === u.id))
    .map((u) => {
      const owned = conversations.filter((c) => c.assignedUserId === u.id);
      const replies = messages.filter((m) => m.direction === 'out' && m.senderUserId === u.id).length;
      return {
        userId: u.id,
        name: u.name,
        role: u.role,
        presence: u.presence,
        assigned: owned.length,
        open: owned.filter((c) => c.status !== 'closed').length,
        replies,
      };
    })
    .sort((a, b) => b.assigned - a.assigned);

  // ── Daily volume (last `days` days) ──────────────────────────────────────
  const volumeByDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const count = conversations.filter((c) => {
      const t = new Date(c.createdAt);
      return t >= d && t < next;
    }).length;
    volumeByDay.push({ date: d.toISOString().slice(0, 10), count });
  }

  // ── Assignment type distribution ─────────────────────────────────────────
  const assignmentByType = {};
  for (const a of assignments) assignmentByType[a.assignmentType] = (assignmentByType[a.assignmentType] || 0) + 1;

  return { totals, byChannel, byGrade, byStage, avgFirstResponseMin, byAgent, volumeByDay, assignmentByType };
}
