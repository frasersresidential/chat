import { db } from '../../store/db.js';
import { simulateDelivery } from '../simulator.js';
import { logger } from '../../logger.js';

const log = logger('ads-meta');
const GRAPH = 'https://graph.facebook.com/v19.0';

/**
 * Meta Marketing API provider (Facebook/Instagram ads).
 *
 * Live mode needs credential { accessToken, adAccountId } where accessToken has
 * `ads_read` + `ads_management` and adAccountId looks like `act_1234567890`.
 * Without credentials the account runs on the simulator, same as chat channels.
 *
 * Money fields on the Graph API are in the currency's minor units (satang for
 * THB) — convert at this boundary only; everything internal is plain THB.
 */
export const metaProvider = {
  platform: 'meta',

  isConfigured(account) {
    return !!(account.credential?.accessToken && account.credential?.adAccountId);
  },

  /** Pull structure + today's insights. Returns [{entityId, kind, values}]. */
  async sync(account) {
    if (!this.isConfigured(account)) {
      const deltas = simulateDelivery(account, elapsedSinceSync(account));
      return Object.entries(deltas).map(([entityId, values]) => ({ entityId, kind: 'delta', values }));
    }

    const token = account.credential.accessToken;
    const act = account.credential.adAccountId;
    const get = async (path, params) => {
      const qs = new URLSearchParams({ ...params, access_token: token, limit: '200' });
      const res = await fetch(`${GRAPH}/${path}?${qs}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || `graph ${res.status}`);
      return data.data || [];
    };

    // 1) Structure — campaigns → ad sets → ads.
    const [campaigns, adsets, ads] = await Promise.all([
      get(`${act}/campaigns`, { fields: 'name,status,effective_status,objective,daily_budget' }),
      get(`${act}/adsets`, { fields: 'name,status,effective_status,daily_budget,bid_amount,campaign_id' }),
      get(`${act}/ads`, { fields: 'name,status,effective_status,adset_id' }),
    ]);

    const upsert = (row, level, parentExternalId) => upsertEntity(account, {
      level,
      externalId: row.id,
      parentExternalId,
      name: row.name,
      status: row.effective_status === 'ACTIVE' || row.status === 'ACTIVE' ? 'active' : 'paused',
      objective: row.objective,
      dailyBudget: row.daily_budget != null ? Number(row.daily_budget) / 100 : null,
      bid: row.bid_amount != null ? Number(row.bid_amount) / 100 : null,
    });
    campaigns.forEach((c) => upsert(c, 'campaign', null));
    adsets.forEach((s) => upsert(s, 'adset', s.campaign_id));
    ads.forEach((a) => upsert(a, 'ad', a.adset_id));

    // 2) Today's insights at ad level (parents are aggregated internally).
    const insights = await get(`${act}/insights`, {
      level: 'ad',
      date_preset: 'today',
      fields: 'ad_id,impressions,clicks,spend,actions,action_values',
    });
    const metrics = [];
    for (const row of insights) {
      const entity = db.adEntities.find((e) => e.accountId === account.id && e.externalId === row.ad_id);
      if (!entity) continue;
      metrics.push({
        entityId: entity.id,
        kind: 'today', // cumulative since midnight — engine diffs it
        values: {
          imp: Number(row.impressions || 0),
          clk: Number(row.clicks || 0),
          spend: Number(row.spend || 0),
          conv: sumActions(row.actions),
          rev: sumActions(row.action_values),
        },
      });
    }
    return metrics;
  },

  /** Apply an optimization action to the live entity. */
  async apply(account, entity, action) {
    // Simulated mode: the optimizer mirrors the change onto our store, and the
    // simulator reads status/budget from there — nothing to call.
    if (!this.isConfigured(account)) return;
    const token = account.credential.accessToken;
    const post = async (params) => {
      const res = await fetch(`${GRAPH}/${entity.externalId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, access_token: token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || `graph ${res.status}`);
    };
    if (action.kind === 'pause') await post({ status: 'PAUSED' });
    else if (action.kind === 'resume') await post({ status: 'ACTIVE' });
    else if (action.kind === 'budget') await post({ daily_budget: String(Math.round(action.to * 100)) });
    else if (action.kind === 'bid') await post({ bid_amount: String(Math.round(action.to * 100)) });
    else throw new Error(`unsupported action ${action.kind}`);
    log.info(`applied ${action.kind} on ${entity.name}`);
  },
};

/** Conversions Meta counts for lead-gen chat funnels. */
const CONV_ACTIONS = ['lead', 'purchase', 'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
function sumActions(actions) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a) => CONV_ACTIONS.includes(a.action_type))
    .reduce((s, a) => s + Number(a.value || 0), 0);
}

/** Shared by providers: upsert one normalized entity row, keeping AI fields. */
export function upsertEntity(account, row) {
  const existing = db.adEntities.find((e) => e.accountId === account.id && e.externalId === row.externalId);
  const parent = row.parentExternalId
    ? db.adEntities.find((e) => e.accountId === account.id && e.externalId === row.parentExternalId)
    : null;
  const patch = {
    name: row.name,
    status: row.status,
    objective: row.objective ?? existing?.objective ?? null,
    dailyBudget: row.dailyBudget ?? null,
    bid: row.bid ?? null,
    parentId: parent?.id ?? existing?.parentId ?? null,
    ext: { ...(existing?.ext || {}), ...(row.ext || {}) },
  };
  if (existing) return db.adEntities.update(existing.id, patch);
  return db.adEntities.insert({
    organizationId: account.organizationId,
    accountId: account.id,
    platform: account.platform,
    level: row.level,
    externalId: row.externalId,
    ...patch,
  });
}

/** Elapsed ms since last sync, for simulator catch-up. Defaults to one minute. */
export function elapsedSinceSync(account) {
  const last = account.lastSyncAt ? new Date(account.lastSyncAt).getTime() : Date.now() - 60000;
  return Math.max(1000, Date.now() - last);
}
