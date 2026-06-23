import { db } from '../store/db.js';

/**
 * Projects map a code/abbreviation (as it appears in a Meta-ads Ad set name) to
 * a display name and a sales team. They drive three things at once:
 *   1. auto-tagging   — the matched project is stamped on the conversation
 *   2. routing        — chats go to the project's sales team
 *   3. reporting      — chats / won / revenue grouped per project
 *
 * Project shape: { id, organizationId, name, code, keywords[], teamId }
 */
export function detectProject(organizationId, adReferral) {
  if (!adReferral) return null;
  const hay = [adReferral.adsetName, adReferral.adName, adReferral.adTitle, adReferral.campaignName, adReferral.utm?.campaign]
    .filter(Boolean).join(' ').toLowerCase();
  if (!hay) return null;
  return db.projects
    .filter((p) => p.organizationId === organizationId)
    .find((p) => (p.keywords || []).some((k) => k && hay.includes(String(k).toLowerCase()))) || null;
}
