import { db } from '../store/db.js';
import { teamRoster } from './teams.js';
import { isEligibleForAssignment, roleDef } from './rbac.js';
import { isAvailable } from './presence.js';
import { notify } from './notifications.js';
import { detectProject } from './projects.js';
import { logger } from '../logger.js';

const log = logger('routing');

export const ASSIGNMENT_TYPE = {
  ROUND_ROBIN: 'round_robin',
  MANUAL: 'manual',
  AI: 'ai',
  TRANSFER: 'transfer',
};

/**
 * Routing engine.
 *
 *   Customer message → detect channel account → find matching routing rule
 *   → pick team → select agent → create conversation_assignment.
 *
 * Rule shape:
 *   { id, channelAccountId, teamId, routingType: 'round_robin'|'manual',
 *     priority (lower runs first),
 *     condition: { type: 'always'|'keyword'|'vip', keywords: [...] },
 *     assignToRole?: 'supervisor'|'agent'|...  // override target role }
 */

function ruleMatches(rule, { text, customer, adReferral }) {
  const cond = rule.condition || { type: 'always' };
  if (cond.type === 'always') return true;
  if (cond.type === 'vip') return !!customer?.vip;
  if (cond.type === 'keyword') {
    const hay = (text || '').toLowerCase();
    return (cond.keywords || []).some((k) => hay.includes(k.toLowerCase()));
  }
  // Project routing: match a code/abbreviation inside the Meta-ads attribution
  // (Ad set name first, then ad/campaign/utm) → send to that project's team.
  if (cond.type === 'adset') {
    if (!adReferral) return false;
    const hay = [adReferral.adsetName, adReferral.adName, adReferral.adTitle, adReferral.campaignName, adReferral.utm?.campaign]
      .filter(Boolean).join(' ').toLowerCase();
    return (cond.keywords || []).some((k) => hay.includes(k.toLowerCase()));
  }
  return false;
}

/** First matching rule for a channel account, evaluated by ascending priority. */
export function findRule(channelAccountId, ctx) {
  const rules = db.routingRules
    .filter((r) => r.channelAccountId === channelAccountId)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return rules.find((r) => ruleMatches(r, ctx)) || null;
}

/**
 * Pick the next eligible, ONLINE agent in a team using a persisted round-robin
 * cursor. Scans forward from the cursor so offline/busy agents are skipped
 * while overall rotation stays fair. Returns null if nobody is available.
 */
function pickRoundRobin(teamId, roleFilter) {
  const active = (u) => u.status !== 'disabled';
  const roster = teamRoster(teamId).filter((u) => {
    const targetRole = roleFilter || null;
    const eligible = targetRole ? u.role === targetRole : isEligibleForAssignment(u);
    return eligible && active(u) && isAvailable(u);
  });
  // Need a stable full roster (incl. offline) for cursor stability:
  const fullRoster = teamRoster(teamId).filter((u) =>
    active(u) && (roleFilter ? u.role === roleFilter : isEligibleForAssignment(u)),
  );
  if (roster.length === 0) return null;

  const key = `${teamId}:${roleFilter || 'eligible'}`;
  const cursor = db.getCursor(key);
  for (let step = 1; step <= fullRoster.length; step++) {
    const idx = (cursor + step) % fullRoster.length;
    const candidate = fullRoster[idx];
    if (isAvailable(candidate)) {
      db.setCursor(key, idx);
      return candidate;
    }
  }
  return null;
}

/**
 * Route a conversation. Mutates nothing on the conversation directly — returns
 * an assignment record (or null when left unassigned) and emits notifications.
 */
export function routeConversation(conversation, { text }) {
  const account = db.channelAccounts.get(conversation.channelAccountId);

  // ── Project detection (from Meta-ads attribution) ────────────────────────
  // Tag the conversation with its project and, when the project has a sales
  // team, route there directly (takes priority over channel rules).
  const project = detectProject(conversation.organizationId, conversation.adReferral);
  if (project) {
    db.conversations.update(conversation.id, { project: { id: project.id, code: project.code, name: project.name } });
    conversation = db.conversations.get(conversation.id);
    if (project.teamId) {
      const agent = pickRoundRobin(project.teamId, null);
      if (agent) {
        const assignment = assign(conversation, agent.id, ASSIGNMENT_TYPE.ROUND_ROBIN);
        notify(agent.id, {
          type: 'assignment',
          title: 'You have a new conversation',
          body: `${conversation.customer?.name || 'Customer'} · โครงการ ${project.name}`,
          conversationId: conversation.id,
        });
        return assignment;
      }
      notifyTeamSupervisors(project.teamId, conversation, `ลูกค้าโครงการ ${project.name} — ไม่มี agent ออนไลน์`);
      return null;
    }
  }

  const ctx = { text, customer: conversation.customer, adReferral: conversation.adReferral };
  const rule = findRule(conversation.channelAccountId, ctx);

  if (!rule) {
    log.warn(`no routing rule for channel account ${conversation.channelAccountId}; left unassigned`);
    return null;
  }

  // Manual routing → no auto owner, notify team supervisors to pick it up.
  if (rule.routingType === 'manual') {
    notifyTeamSupervisors(rule.teamId, conversation, 'New conversation awaiting manual assignment');
    return null;
  }

  // Priority/VIP/keyword rules may target a specific role (e.g. supervisor).
  const roleFilter = rule.assignToRole || null;
  const agent = pickRoundRobin(rule.teamId, roleFilter);

  if (!agent) {
    log.warn(`no available agent in team ${rule.teamId} for conversation ${conversation.id}`);
    notifyTeamSupervisors(rule.teamId, conversation, 'Unassigned conversation — no agent online');
    return null;
  }

  const assignment = assign(conversation, agent.id, ASSIGNMENT_TYPE.ROUND_ROBIN);

  notify(agent.id, {
    type: 'assignment',
    title: 'You have a new conversation',
    body: `${conversation.customer?.name || 'Customer'} via ${account?.accountName || conversation.channel}`,
    conversationId: conversation.id,
  });

  // High-priority conversations also ping supervisors.
  if (rule.condition?.type === 'vip' || rule.condition?.type === 'keyword') {
    notifyTeamSupervisors(rule.teamId, conversation, 'New high priority conversation');
  }

  return assignment;
}

/** Create/replace the active assignment for a conversation. */
export function assign(conversation, userId, assignmentType) {
  const assignment = db.assignments.insert({
    conversationId: conversation.id,
    assignedUserId: userId,
    assignedAt: new Date().toISOString(),
    assignmentType,
  });
  db.conversations.update(conversation.id, {
    assignedUserId: userId,
    teamId: conversation.teamId || null,
  });
  return assignment;
}

/** Manager/Supervisor takeover or transfer — history is always preserved. */
export function transfer(conversation, toUserId, byUserId) {
  const assignment = db.assignments.insert({
    conversationId: conversation.id,
    assignedUserId: toUserId,
    assignedAt: new Date().toISOString(),
    assignmentType: ASSIGNMENT_TYPE.TRANSFER,
    transferredBy: byUserId,
  });
  db.conversations.update(conversation.id, { assignedUserId: toUserId });
  notify(toUserId, {
    type: 'transfer',
    title: 'A conversation was transferred to you',
    body: `${conversation.customer?.name || 'Customer'} (${conversation.channel})`,
    conversationId: conversation.id,
  });
  return assignment;
}

function notifyTeamSupervisors(teamId, conversation, title) {
  for (const member of teamRoster(teamId)) {
    const canSupervise = ['supervisor', 'manager', 'admin', 'owner'].includes(member.role);
    if (canSupervise) {
      notify(member.id, {
        type: 'supervisor_alert',
        title,
        body: `${conversation.customer?.name || 'Customer'} via ${conversation.channel}`,
        conversationId: conversation.id,
      });
    }
  }
}

/** Full assignment history for a conversation (newest first). */
export function assignmentHistory(conversationId) {
  return db.assignments
    .filter((a) => a.conversationId === conversationId)
    .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));
}
