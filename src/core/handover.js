import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { notify } from './notifications.js';
import { transfer, reassignWithinTeam } from './routing.js';
import { logger } from '../logger.js';

const log = logger('handover');

/**
 * Redistribute an agent's open conversations when they leave (resign / move
 * project or team). Each chat is handed over — history preserved — to:
 *   1. an explicit target user (toUserId), or
 *   2. another available agent in the chat's project team (round-robin), or
 *   3. left unassigned + supervisors notified, if nobody is available.
 *
 * The new owner gets a fresh SLA window.
 */
export function handoverUserConversations(fromUserId, { toUserId = null, toTeamId = null, byUserId = null } = {}) {
  const open = db.conversations.filter((c) => c.assignedUserId === fromUserId && c.status !== 'resolved');
  const fromName = db.users.get(fromUserId)?.name || 'agent';
  let reassigned = 0;
  let unassigned = 0;

  for (const c of open) {
    let newOwnerId = null;

    if (toUserId && db.users.get(toUserId)) {
      transfer(c, toUserId, byUserId); // notifies the target itself
      newOwnerId = toUserId;
    } else {
      const teamId = c.project?.id ? db.projects.get(c.project.id)?.teamId : toTeamId;
      const agent = teamId ? reassignWithinTeam(c, teamId, fromUserId) : null;
      if (agent) {
        newOwnerId = agent.id;
        notify(agent.id, {
          type: 'transfer',
          title: '📋 รับโอนลูกค้า',
          body: `${c.customer?.name || 'ลูกค้า'} โอนมาให้คุณ (${fromName} ออกจากโครงการ/ทีม)${c.project ? ` · ${c.project.name}` : ''}`,
          conversationId: c.id,
        });
      }
    }

    if (newOwnerId) {
      db.conversations.update(c.id, {
        waitingSince: c.waitingSince ? new Date().toISOString() : null,
        slaBreachedAt: null, slaReassignCount: 0,
      });
      reassigned += 1;
    } else {
      db.conversations.update(c.id, { assignedUserId: null, slaBreachedAt: null, slaReassignCount: 0 });
      unassigned += 1;
      for (const u of db.users.filter((u) => u.organizationId === c.organizationId &&
        ['supervisor', 'manager'].includes(u.role) && u.status !== 'disabled')) {
        notify(u.id, {
          type: 'handover_unassigned',
          title: '⚠️ ลูกค้าไม่มีผู้ดูแล',
          body: `${c.customer?.name || 'ลูกค้า'} (${fromName} ออก) — ไม่มี agent ว่างในโครงการ ต้องมอบหมายเอง${c.project ? ` · ${c.project.name}` : ''}`,
          conversationId: c.id,
        });
      }
    }
    bus.emit('conversation:upserted', db.conversations.get(c.id));
  }

  log.info(`handover ${fromName}: ${reassigned} reassigned, ${unassigned} unassigned of ${open.length}`);
  return { total: open.length, reassigned, unassigned };
}
