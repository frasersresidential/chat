import { db } from '../store/db.js';
import { roleDef } from './rbac.js';

/**
 * Analytics for an organization. Computed on demand from the document store —
 * fine for a single node; precompute/materialize when you outgrow it.
 *
 * Returns conversation totals, per-channel and per-agent breakdowns, first
 * response time, daily volume (last 7 days) and assignment-type distribution.
 */
export function buildReport(organizationId, { rangeDays = null } = {}) {
  const from = rangeDays ? new Date(Date.now() - rangeDays * 86400000) : null;
  const conversations = db.conversations.filter((c) =>
    c.organizationId === organizationId && (!from || new Date(c.createdAt) >= from));
  const convIds = new Set(conversations.map((c) => c.id));
  const days = Math.min(rangeDays || 7, 30);
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

  // ── Facebook Ads attribution (chats started from a Click-to-Messenger ad) ─
  const byAdSet = {};
  const byAd = {};
  let fromAds = 0;
  // ROI funnel per ad set: chats → won, plus revenue from deal values.
  const roiByAdSet = {};
  let adsWon = 0, adsRevenue = 0;
  for (const c of conversations) {
    const r = c.adReferral;
    if (!r) continue;
    fromAds += 1;
    const adset = r.adsetName || r.utm?.campaign || 'ไม่ทราบ Ad set';
    const ad = r.adName || r.adTitle || 'ไม่ทราบ Ad';
    byAdSet[adset] = (byAdSet[adset] || 0) + 1;
    byAd[ad] = (byAd[ad] || 0) + 1;

    const row = roiByAdSet[adset] || (roiByAdSet[adset] = { adset, chats: 0, won: 0, lost: 0, revenue: 0 });
    row.chats += 1;
    if (c.stage === 'won') { row.won += 1; adsWon += 1; }
    if (c.stage === 'lost') row.lost += 1;
    const dv = Number(c.dealValue) || 0;
    if (dv) { row.revenue += dv; adsRevenue += dv; }
  }
  const adRoi = Object.values(roiByAdSet)
    .map((r) => ({ ...r, conversion: r.chats ? +(r.won / r.chats * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.chats - a.chats);
  totals.fromAds = fromAds;
  totals.adsWon = adsWon;
  totals.adsRevenue = adsRevenue;

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

  return { range: rangeDays || 'all', totals, byChannel, byGrade, byStage, byAdSet, byAd, adRoi, avgFirstResponseMin, byAgent, volumeByDay, assignmentByType };
}

// ── CSV export ────────────────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (header, rows) =>
  '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM for Excel/Thai

/** Conversations export — one row per conversation. */
export function exportConversationsCSV(organizationId, { rangeDays = null } = {}) {
  const from = rangeDays ? new Date(Date.now() - rangeDays * 86400000) : null;
  const rows = db.conversations
    .filter((c) => c.organizationId === organizationId && (!from || new Date(c.createdAt) >= from))
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
    .map((c) => {
      const owner = c.assignedUserId ? db.users.get(c.assignedUserId) : null;
      const account = db.channelAccounts.get(c.channelAccountId);
      const r = c.adReferral || {};
      return [
        c.id, c.customer?.name, c.channel, account?.accountName || '', owner?.name || 'Unassigned',
        c.grade || '', c.stage || 'new', c.status || 'open', c.customer?.vip ? 'VIP' : '',
        (c.tags || []).join('|'),
        r.adName || r.adTitle || '', r.adsetName || '', r.campaignName || '', r.ref || '',
        c.createdAt, c.lastMessageAt,
      ];
    });
  return toCSV(
    ['id', 'customer', 'channel', 'account', 'owner', 'grade', 'stage', 'status', 'vip', 'tags',
      'ad_name', 'ad_set_name', 'campaign_name', 'ad_ref', 'created_at', 'last_message_at'],
    rows,
  );
}

/** Agent performance export — one row per agent. */
export function exportAgentsCSV(organizationId, opts = {}) {
  const { byAgent } = buildReport(organizationId, opts);
  return toCSV(
    ['agent', 'role', 'presence', 'assigned', 'open', 'replies'],
    byAgent.map((a) => [a.name, a.role, a.presence, a.assigned, a.open, a.replies]),
  );
}
