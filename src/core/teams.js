import { db } from '../store/db.js';

/** Members of a team as { ...user, teamRole } records, in stable insert order. */
export function teamRoster(teamId) {
  const memberships = db.teamMembers
    .filter((m) => m.teamId === teamId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return memberships
    .map((m) => {
      const user = db.users.get(m.userId);
      return user ? { ...user, teamRole: m.role, membershipId: m.id } : null;
    })
    .filter(Boolean);
}

/** Team ids a user belongs to. */
export function teamsForUser(userId) {
  return db.teamMembers
    .filter((m) => m.userId === userId)
    .map((m) => m.teamId);
}

/** Direct child teams (org chart traversal). */
export function childTeams(teamId) {
  return db.teams.filter((t) => t.parentId === teamId);
}

/** Build the org's team tree for the admin UI. */
export function teamTree(orgId) {
  const teams = db.teams.filter((t) => t.organizationId === orgId);
  const byParent = {};
  for (const t of teams) {
    const key = t.parentId || 'root';
    (byParent[key] ||= []).push(t);
  }
  const build = (parentKey) =>
    (byParent[parentKey] || []).map((t) => ({
      ...t,
      members: teamRoster(t.id).map((u) => ({ id: u.id, name: u.name, role: u.role, teamRole: u.teamRole })),
      children: build(t.id),
    }));
  return build('root');
}
