import { db } from '../store/db.js';
import { notify } from './notifications.js';
import { logger } from '../logger.js';

const log = logger('daily-report');

const RECIPIENT_ROLES = ['supervisor', 'manager', 'admin', 'owner'];

/**
 * Snapshot of conversations still awaiting an agent reply ("ค้างตอบ"):
 * open conversations whose last message came from the customer. Grouped by
 * the owning sales agent and by project.
 */
export function buildPendingSummary(organizationId) {
  const open = db.conversations.filter((c) => c.organizationId === organizationId && c.status !== 'resolved');
  // "Pending" = the customer's latest message has no HUMAN reply after it.
  // Auto-replies (bot) don't count as answering.
  const pending = open.filter((c) => {
    const msgs = db.messages.filter((m) => m.conversationId === c.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
    if (!lastIn) return false;
    const answered = msgs.some((m) => m.direction === 'out' && !m.auto && new Date(m.createdAt) >= new Date(lastIn.createdAt));
    return !answered;
  });

  const byAgentMap = {};
  const byProjectMap = {};
  let unassigned = 0;
  for (const c of pending) {
    const proj = c.project?.name || 'ไม่ระบุโครงการ';
    byProjectMap[proj] = (byProjectMap[proj] || 0) + 1;
    if (!c.assignedUserId) { unassigned += 1; continue; }
    const a = byAgentMap[c.assignedUserId] || (byAgentMap[c.assignedUserId] = {
      userId: c.assignedUserId, name: db.users.get(c.assignedUserId)?.name || c.assignedUserId, count: 0, projects: {},
    });
    a.count += 1;
    a.projects[proj] = (a.projects[proj] || 0) + 1;
  }
  return {
    totalPending: pending.length,
    unassignedPending: unassigned,
    byAgent: Object.values(byAgentMap).sort((a, b) => b.count - a.count),
    byProject: Object.entries(byProjectMap).map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count),
    generatedAt: new Date().toISOString(),
  };
}

/** Render the summary as a notification body. */
function summaryText(s) {
  const lines = [`แชตค้างตอบทั้งหมด ${s.totalPending} ราย`];
  for (const a of s.byAgent) {
    const proj = Object.entries(a.projects).map(([p, n]) => `${p} ${n}`).join(', ');
    lines.push(`• ${a.name}: ${a.count} ราย${proj ? ` (${proj})` : ''}`);
  }
  if (s.unassignedPending) lines.push(`• ยังไม่มอบหมาย: ${s.unassignedPending} ราย`);
  return lines.join('\n');
}

/** Send the pending-chats daily report to supervisors & managers. */
export function sendDailyReport(organizationId) {
  const summary = buildPendingSummary(organizationId);
  const body = summaryText(summary);
  const recipients = db.users.filter((u) =>
    u.organizationId === organizationId && u.status !== 'disabled' && RECIPIENT_ROLES.includes(u.role));
  for (const u of recipients) {
    notify(u.id, { type: 'daily_report', title: '📊 Daily Report — แชตค้างตอบ', body, conversationId: null });
  }
  log.info(`daily report sent to ${recipients.length} leaders (${summary.totalPending} pending)`);
  return { sent: recipients.length, summary };
}

export function defaultDailyReport() {
  return { enabled: true, time: '18:00' };
}

/** Current { date:'YYYY-MM-DD', hhmm:'HH:MM' } in a timezone. */
function nowInZone(timezone) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Asia/Bangkok',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
  } catch {
    const d = new Date();
    return { date: d.toISOString().slice(0, 10), hhmm: d.toTimeString().slice(0, 5) };
  }
}

let timer = null;
/** Fire each org's daily report once, at its configured local time. */
export function startDailyReportScheduler(intervalMs = 60000) {
  if (timer) return;
  timer = setInterval(() => {
    for (const org of db.organizations.all()) {
      const cfg = org.dailyReport;
      if (!cfg || !cfg.enabled) continue;
      const { date, hhmm } = nowInZone(org.businessHours?.timezone);
      if (hhmm === cfg.time && org.dailyReportLastSent !== date) {
        sendDailyReport(org.id);
        db.organizations.update(org.id, { dailyReportLastSent: date });
      }
    }
  }, intervalMs);
  timer.unref?.();
}
