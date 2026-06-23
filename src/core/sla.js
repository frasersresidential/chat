import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { notify } from './notifications.js';
import { reassignWithinTeam } from './routing.js';
import { logger } from '../logger.js';

const log = logger('sla');

export function defaultSla() {
  return { enabled: true, minutes: 30, escalate: true, reassign: true };
}

/** Notify the team's supervisors/managers about a breached conversation. */
function escalate(c, minutes, reassigned) {
  const owner = c.assignedUserId ? db.users.get(c.assignedUserId)?.name : 'ไม่มอบหมาย';
  const action = reassigned ? `→ ส่งต่อให้ ${reassigned.name}` : 'ยังไม่มีใครรับ';
  for (const u of db.users.filter((u) => u.organizationId === c.organizationId &&
    ['supervisor', 'manager'].includes(u.role) && u.status !== 'disabled')) {
    notify(u.id, {
      type: 'sla_escalation',
      title: '🚨 SLA: ลูกค้าค้างตอบ',
      body: `${c.customer?.name || 'ลูกค้า'} ค้างตอบเกิน ${minutes} นาที — เดิม ${owner} ${action}${c.project ? ` · ${c.project.name}` : ''}`,
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
        const prevOwnerId = c.assignedUserId;
        const teamId = c.project?.id ? db.projects.get(c.project.id)?.teamId : null;
        const reassignCount = c.slaReassignCount || 0;

        // Try to round-robin to another available agent in the project's team.
        let reassigned = null;
        if (sla.reassign && teamId && reassignCount < 5) {
          reassigned = reassignWithinTeam(db.conversations.get(c.id), teamId, prevOwnerId);
        }

        if (reassigned) {
          // Fresh SLA window for the new owner; clear the breach flag so the
          // cycle can repeat (rotating to the next agent) if they also stall.
          db.conversations.update(c.id, {
            assignedUserId: reassigned.id,
            waitingSince: new Date().toISOString(),
            slaBreachedAt: null,
            slaReassignCount: reassignCount + 1,
          });
          notify(reassigned.id, {
            type: 'assignment',
            title: '⏱️ รับช่วงต่อ (SLA)',
            body: `${c.customer?.name || 'ลูกค้า'} ส่งต่อมาให้คุณ (ค้างตอบเกิน ${sla.minutes} นาที)${c.project ? ` · ${c.project.name}` : ''}`,
            conversationId: c.id,
          });
          if (prevOwnerId && prevOwnerId !== reassigned.id) {
            notify(prevOwnerId, {
              type: 'sla',
              title: '⏱️ แชตถูกส่งต่อ',
              body: `${c.customer?.name || 'ลูกค้า'} ถูกส่งต่อให้ ${reassigned.name} (ค้างตอบเกิน SLA)`,
              conversationId: c.id,
            });
          }
          if (sla.escalate) escalate(c, sla.minutes, reassigned);
          log.info(`SLA breach ${c.id} → reassigned to ${reassigned.name}`);
        } else {
          // No other agent available (or cap reached) — alert + escalate only.
          db.conversations.update(c.id, { slaBreachedAt: new Date().toISOString() });
          if (prevOwnerId) {
            notify(prevOwnerId, {
              type: 'sla',
              title: '⏱️ ลูกค้ารอเกิน SLA',
              body: `${c.customer?.name || 'ลูกค้า'} รอเกิน ${sla.minutes} นาที${c.project ? ` · ${c.project.name}` : ''}`,
              conversationId: c.id,
            });
          }
          if (sla.escalate) escalate(c, sla.minutes, null);
          log.info(`SLA breach ${c.id} (no reassign)`);
        }
        bus.emit('conversation:upserted', db.conversations.get(c.id));
      }
    }
  }, intervalMs);
  timer.unref?.();
}
