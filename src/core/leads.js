/**
 * Prospect leads: import customer visit/enquiry reports, normalize them, score
 * each one with the lead-scoring engine and keep them queryable for the UI.
 *
 * The sample import is a Salesforce-style "CoSale Visit & Revisit Report"
 * (Thai housing sales), but the importer is tolerant: it matches columns by
 * fuzzy header name, so most CRM exports (xlsx or csv) map cleanly.
 */
import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { parseSheet } from './xlsx.js';
import { scoreLead, analyzeNotes } from './leadScoring.js';
import { logger } from '../logger.js';

const log = logger('leads');

/** Find the first header whose name contains any of the candidate substrings. */
function header(row, candidates, { exclude = [] } = {}) {
  const keys = Object.keys(row);
  // Prefer an exact (case-insensitive) match, then a "contains" match.
  for (const cand of candidates) {
    const exact = keys.find((k) => k.toLowerCase().trim() === cand.toLowerCase());
    if (exact && !exclude.some((x) => exact.toLowerCase().includes(x))) return row[exact];
  }
  for (const cand of candidates) {
    const k = keys.find((k) => k.toLowerCase().includes(cand.toLowerCase())
      && !exclude.some((x) => k.toLowerCase().includes(x)));
    if (k) return row[k];
  }
  return '';
}

const truthy = (v) => /^(1|true|yes|y|จริง)$/i.test(String(v || '').trim());

/** Map one raw report row → a normalized lead object. */
export function normalizeCoSaleRow(row) {
  const comments = header(row, ['Comments']);
  const remark = header(row, ['Remark'], { exclude: ['visit'] });
  const visitRemark = header(row, ['Visit Remark']);
  const notes = [comments, remark].filter(Boolean).join('\n').trim() || comments || remark || '';

  const utm = {};
  for (const k of Object.keys(row)) {
    const m = k.match(/utm[_ ]?(\w+)/i);
    if (m && row[k]) utm[m[1].toLowerCase()] = String(row[k]).trim();
  }

  return {
    project: String(header(row, ['Project Name', 'Project']) || '').trim(),
    customerName: String(header(row, ['Account Name', 'Customer', 'Name'], { exclude: ['owner', 'visit owner'] }) || '').trim(),
    mobile: String(header(row, ['Mobile', 'Phone', 'Tel']) || '').trim(),
    createdDate: String(header(row, ['Created Date', 'Created']) || '').trim(),
    revisit: truthy(header(row, ['Transaction Revisit', 'Revisit'])),
    stage: String(header(row, ['Stage', 'Status']) || '').trim(),
    leadSource: String(header(row, ['Lead Source', 'Source']) || '').trim(),
    province: String(header(row, ['Province'], { exclude: ['work'] }) || '').trim(),
    district: String(header(row, ['District'], { exclude: ['work', 'sub'] }) || '').trim(),
    budget: String(header(row, ['Budget']) || '').trim(),
    salary: String(header(row, ['Salary', 'Income']) || '').trim(),
    occupation: String(header(row, ['Occupation', 'Job']) || '').trim(),
    grading: String(header(row, ['Grading (Visit)', 'Grading', 'Grade']) || '').trim(),
    owner: String(header(row, ['Visit Owner', 'Owner']) || '').trim(),
    amount: Number(String(header(row, ['Amount']) || '').replace(/[^\d.]/g, '')) || null,
    netPrice: Number(String(header(row, ['Net Price']) || '').replace(/[^\d.]/g, '')) || null,
    visitRemark: String(visitRemark || '').trim(),
    prebookingId: String(header(row, ['PrebookingId', 'Prebooking', 'Booking']) || '').trim(),
    plotCode: String(header(row, ['Plot Code', 'Unit']) || '').trim(),
    notes,
    utm,
  };
}

/** Stable identity for de-duping re-imports of the same customer/visit. */
function leadKey(lead) {
  return [lead.mobile, lead.project, lead.createdDate, lead.plotCode]
    .map((s) => String(s || '').toLowerCase().trim()).join('|');
}

/** Build the persisted shape: normalized lead + score breakdown. */
export function buildLeadRecord(organizationId, raw, extra = {}) {
  const lead = normalizeCoSaleRow(raw);
  const scored = scoreLead(lead);
  return {
    organizationId,
    ...lead,
    dedupeKey: leadKey(lead),
    score: scored.score,
    tier: scored.tier,
    intent: scored.intent,
    fit: scored.fit,
    converted: scored.converted,
    signals: scored.analysis,
    factors: scored.factors,
    ...extra,
  };
}

/**
 * Import a spreadsheet buffer (xlsx/csv) of leads for an org.
 * Existing leads with the same dedupeKey are updated rather than duplicated.
 */
export function importLeads(organizationId, buffer, filename, { userId = null } = {}) {
  const { headers, rows } = parseSheet(buffer, filename);
  if (!rows.length) throw new Error('ไม่พบข้อมูลในไฟล์ (no data rows found)');

  const batchId = 'imp_' + Date.now().toString(36);
  const importedAt = new Date().toISOString();
  const existing = new Map(
    db.leads.filter((l) => l.organizationId === organizationId).map((l) => [l.dedupeKey, l]),
  );

  let created = 0; let updated = 0; let skipped = 0;
  const records = [];
  for (const row of rows) {
    const rec = buildLeadRecord(organizationId, row, { source: 'import', batchId, importedAt, importedBy: userId });
    // A row with neither a name nor a phone is noise (banner/total rows).
    if (!rec.customerName && !rec.mobile) { skipped++; continue; }
    const prior = existing.get(rec.dedupeKey);
    if (prior) { records.push(db.leads.update(prior.id, rec)); updated++; }
    else { records.push(db.leads.insert(rec)); created++; }
  }

  log.info(`import ${filename || 'sheet'}: +${created} ~${updated} (skipped ${skipped}) for org ${organizationId}`);
  bus.emit('leads:imported', { organizationId, batchId, created, updated });
  return {
    batchId, headers, totalRows: rows.length, created, updated, skipped,
    imported: created + updated,
    tierCounts: tierCounts(records),
    sample: records.slice(0, 5).map(publicLead),
  };
}

const tierCounts = (leads) => leads.reduce((acc, l) => { acc[l.tier] = (acc[l.tier] || 0) + 1; return acc; }, { hot: 0, warm: 0, cold: 0 });

/** Trim a stored lead for API responses (drop bulky raw note text by default). */
export function publicLead(l, { full = false } = {}) {
  if (!l) return l;
  const base = {
    id: l.id, customerName: l.customerName, mobile: l.mobile, project: l.project,
    province: l.province, stage: l.stage, grading: l.grading, leadSource: l.leadSource,
    budget: l.budget, salary: l.salary, occupation: l.occupation, revisit: l.revisit,
    amount: l.amount, netPrice: l.netPrice, owner: l.owner, createdDate: l.createdDate,
    score: l.score, tier: l.tier, intent: l.intent, fit: l.fit, converted: l.converted,
    signals: l.signals, importedAt: l.importedAt,
  };
  return full ? { ...base, factors: l.factors, notes: l.notes, visitRemark: l.visitRemark, utm: l.utm } : base;
}

/** Ranked, filterable list of scored leads for the org. */
export function listLeads(organizationId, { tier = null, project = null, q = null, minScore = null, limit = 500 } = {}) {
  const term = q ? String(q).toLowerCase().trim() : null;
  return db.leads
    .filter((l) => l.organizationId === organizationId
      && (!tier || l.tier === tier)
      && (!project || l.project === project)
      && (minScore == null || l.score >= minScore)
      && (!term || [l.customerName, l.mobile, l.project, l.owner].some((v) => String(v || '').toLowerCase().includes(term))))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((l) => publicLead(l));
}

export function getLead(organizationId, id) {
  const l = db.leads.get(id);
  if (!l || l.organizationId !== organizationId) return null;
  return publicLead(l, { full: true });
}

/** Org-level rollup for the dashboard header + per-project performance. */
export function leadsSummary(organizationId) {
  const leads = db.leads.filter((l) => l.organizationId === organizationId);
  const byProject = {};
  for (const l of leads) {
    const key = l.project || '(ไม่ระบุโครงการ)';
    const row = byProject[key] || (byProject[key] = { project: key, leads: 0, hot: 0, scoreSum: 0, converted: 0 });
    row.leads += 1; row.scoreSum += l.score;
    if (l.tier === 'hot') row.hot += 1;
    if (l.converted) row.converted += 1;
  }
  const projects = Object.values(byProject)
    .map((r) => ({ project: r.project, leads: r.leads, hot: r.hot, converted: r.converted, avgScore: r.leads ? Math.round(r.scoreSum / r.leads) : 0 }))
    .sort((a, b) => b.avgScore - a.avgScore);

  return {
    total: leads.length,
    tierCounts: tierCounts(leads),
    avgScore: leads.length ? Math.round(leads.reduce((a, l) => a + l.score, 0) / leads.length) : 0,
    converted: leads.filter((l) => l.converted).length,
    projects,
    lastImportAt: leads.reduce((max, l) => (l.importedAt > max ? l.importedAt : max), ''),
  };
}

// ── CSV export (ranked prospect list) ───────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function exportLeadsCSV(organizationId, opts = {}) {
  const rows = listLeads(organizationId, { ...opts, limit: 100000 }).map((l) => [
    l.score, l.tier, l.intent, l.fit, l.converted ? 'won' : '', l.customerName, l.mobile,
    l.project, l.province, l.grading, l.stage, l.budget, l.salary, l.occupation,
    l.leadSource, l.revisit ? 'revisit' : '', l.owner, l.createdDate,
  ]);
  const header = ['score', 'tier', 'intent', 'fit', 'converted', 'customer', 'mobile', 'project',
    'province', 'grading', 'stage', 'budget', 'salary', 'occupation', 'lead_source', 'revisit', 'owner', 'created_date'];
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Remove every imported lead for an org (lets the user re-import cleanly). */
export function clearLeads(organizationId) {
  const ids = db.leads.filter((l) => l.organizationId === organizationId).map((l) => l.id);
  ids.forEach((id) => db.leads.remove(id));
  return { removed: ids.length };
}

// ── Bonus: score a live chat conversation with the same engine ──────────────────
// Lets the existing inbox surface "hot prospect" chats using whatever signals a
// conversation carries (grade, pipeline stage, message text, deal value).
export function scoreConversation(conversation) {
  if (!conversation) return null;
  const msgs = db.messages.filter((m) => m.conversationId === conversation.id);
  const inboundText = msgs.filter((m) => m.direction === 'in').map((m) => m.text || '').join('\n');
  const lead = {
    customerName: conversation.customer?.name,
    grading: conversation.grade,
    stage: conversation.stage,
    revisit: msgs.filter((m) => m.direction === 'in').length >= 3, // repeat engagement
    notes: inboundText,
    province: '',
    leadSource: conversation.channel,
    salary: conversation.customer?.vip ? 'มากกว่า 100,000' : '',
    budget: conversation.dealValue ? `${(conversation.dealValue / 1_000_000).toFixed(2)}` : '',
    occupation: '',
  };
  return scoreLead(lead);
}

export { analyzeNotes };
