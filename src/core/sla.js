import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { notify } from './notifications.js';
import { logger } from '../logger.js';

const log = logger('sla');

export function defaultSla() {
  return { enabled: true, minutes: 30, escalate: true };
}

/** Notify the team's supervisors/managers about a breached conversation. */
function escalate(c, minutes) {
  const owner = c.assignedUserId ? db.users.get(c.assignedUserId)?.name : 'ไม่มอบหมาย';
  for (const u of db.users.filter((u) => u.organizationId === c.organizationId &&
    ['supervisor', 'manager'].includes(u.role) && u.status !== 'disabled')) {
    notify(u.id, {
      type: 'sla_escalation',
      title: '🚨 SLA: ลูกค้าค้างตอบ',
      body: `${c.customer?.name || 'ลูกค้า'} ค้างตอบเกิน ${minutes} นาที — ${owner}${c.project ? ` · ${c.project.name}` : ''}`,
      conversationId: c.id,
    });
  }
}

let timer = null;
/**
 * Real-time SLA monitor. Flags conversations whose customer has waited longer
 * than the org's SLA (minutes) without a human reply, alerting the owner and
 * (optionally) escalating to supervisors/managers — once per wait cycle.
 */
export function startSlaMonitor(intervalMs = 60000) {
  if (timer) return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const org of db.organizations.all()) {
      const sla = org.sla;
      if (!sla || !sla.enabled) continue;
      const limitMs = (sla.minutes || 30) * 60000;
      const breached = db.conversations.filter((c) =>
        c.organizationId === org.id && c.status !== 'resolved' && c.waitingSince && !c.slaBreachedAt &&
        now - new Date(c.waitingSince).getTime() >= limitMs);
      for (const c of breached) {
        db.conversations.update(c.id, { slaBreachedAt: new Date().toISOString() });
        if (c.assignedUserId) {
          notify(c.assignedUserId, {
            type: 'sla',
            title: '⏱️ ลูกค้ารอเกิน SLA',
            body: `${c.customer?.name || 'ลูกค้า'} รอเกิน ${sla.minutes} นาที${c.project ? ` · ${c.project.name}` : ''}`,
            conversationId: c.id,
          });
        }
        if (sla.escalate) escalate(c, sla.minutes);
        bus.emit('conversation:upserted', db.conversations.get(c.id));
        log.info(`SLA breach ${c.id} (${sla.minutes}m)`);
      }
    }
  }, intervalMs);
  timer.unref?.();
}
