import { db } from '../store/db.js';
import { bus } from './eventBus.js';
import { logger } from '../logger.js';

const log = logger('ads');

/**
 * Resolve human-readable Ad name / Ad set name / Campaign name from a Click-to-
 * Messenger `ad_id` via the Graph API, then patch the conversation's adReferral.
 *
 * Fire-and-forget: requires the page token to have `ads_read`. If no token (or
 * the call fails) we keep whatever the webhook already gave us (e.g. ad_title).
 */
export async function enrichAdReferralAsync(account, conversation) {
  const r = conversation.adReferral;
  if (!r || !r.adId) return;
  if (r.adName && r.adsetName) return; // already known (e.g. from simulator)
  const token = account?.credential?.accessToken;
  if (!token) return;

  try {
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(r.adId)}` +
      `?fields=name,adset{name},campaign{name}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) { log.warn(`ad lookup ${r.adId} → ${res.status}`); return; }
    const data = await res.json();
    const enriched = {
      ...r,
      adName: data.name || r.adName,
      adsetName: data.adset?.name || r.adsetName,
      campaignName: data.campaign?.name || r.campaignName,
    };
    const updated = db.conversations.update(conversation.id, { adReferral: enriched });
    if (updated) bus.emit('conversation:upserted', updated);
    log.info(`enriched ad ${r.adId}: ${enriched.adName} / ${enriched.adsetName}`);
  } catch (e) {
    log.warn(`ad enrich failed: ${e.message}`);
  }
}
