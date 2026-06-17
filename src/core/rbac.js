/**
 * Role-Based Access Control.
 *
 * Permissions are coarse capability flags. Each role maps to a set of them.
 * `eligibleForAssignment` is special: it controls whether a user can ever be
 * the *owner* of a conversation via the routing engine (round robin / skill).
 * Managers, Supervisors (by default) and Viewers are NOT eligible — they
 * observe and intervene, but ownership flows to Sales Agents.
 */
export const PERMISSIONS = {
  MANAGE_BILLING: 'manage_billing',
  MANAGE_ORG: 'manage_org',
  MANAGE_USERS: 'manage_users',
  MANAGE_CHANNELS: 'manage_channels',
  MANAGE_TEAMS: 'manage_teams',
  MANAGE_ROUTING: 'manage_routing',
  MANAGE_AUTOMATION: 'manage_automation',
  VIEW_ALL_CONVERSATIONS: 'view_all_conversations',
  VIEW_TEAM_CONVERSATIONS: 'view_team_conversations',
  VIEW_ANALYTICS: 'view_analytics',
  REPLY: 'reply',
  ASSIGN: 'assign',
  TAKEOVER: 'takeover',
  TRANSFER: 'transfer',
};

const P = PERMISSIONS;

export const ROLES = {
  owner: {
    label: 'Owner',
    eligibleForAssignment: false,
    permissions: Object.values(P), // everything
  },
  admin: {
    label: 'Admin',
    eligibleForAssignment: false,
    permissions: [
      P.MANAGE_USERS, P.MANAGE_CHANNELS, P.MANAGE_TEAMS, P.MANAGE_ROUTING,
      P.MANAGE_AUTOMATION, P.VIEW_ALL_CONVERSATIONS, P.VIEW_ANALYTICS,
      P.REPLY, P.ASSIGN, P.TAKEOVER, P.TRANSFER,
    ],
  },
  manager: {
    label: 'Manager',
    eligibleForAssignment: false, // "Cannot: Receive round robin assignment"
    permissions: [
      P.VIEW_ALL_CONVERSATIONS, P.VIEW_TEAM_CONVERSATIONS, P.VIEW_ANALYTICS,
      P.REPLY, P.ASSIGN, P.TAKEOVER, P.TRANSFER,
    ],
  },
  supervisor: {
    label: 'Supervisor',
    eligibleForAssignment: false,
    permissions: [
      P.VIEW_TEAM_CONVERSATIONS, P.REPLY, P.ASSIGN, P.TAKEOVER, P.TRANSFER,
    ],
  },
  agent: {
    label: 'Sales Agent',
    eligibleForAssignment: true, // the only role routing assigns ownership to
    permissions: [P.REPLY],
  },
  viewer: {
    label: 'Viewer / Observer',
    eligibleForAssignment: false,
    permissions: [P.VIEW_ALL_CONVERSATIONS],
  },
};

export function roleDef(role) {
  return ROLES[role] || ROLES.viewer;
}

export function can(user, permission) {
  if (!user) return false;
  return roleDef(user.role).permissions.includes(permission);
}

export function isEligibleForAssignment(user) {
  return !!user && roleDef(user.role).eligibleForAssignment;
}
