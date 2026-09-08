import { db } from '../../store/db.js';
import { config } from '../../config.js';
import { simulateDelivery } from '../simulator.js';
import { upsertEntity, elapsedSinceSync } from './meta.js';
import { logger } from '../../logger.js';

const log = logger('ads-google');

/**
 * Google Ads API provider (Search / PMax / Display).
 *
 * Live mode needs credential { developerToken, clientId, clientSecret,
 * refreshToken, customerId } (+ optional loginCustomerId for MCC access).
 * Money is in micros on the wire (×1,000,000) — converted at this boundary.
 *
 * Levels map onto the shared model: campaign → adset (= ad group) → ad.
 * Budgets live on the campaign; CPC bids on the ad group.
 */
const API = () => `https://googleads.googleapis.com/${config.ads.googleApiVersion}`;
const fromMicros = (m) => (m == null ? null : Number(m) / 1e6);
const toMicros = (n) => String(Math.round(n * 1e6));

// Access tokens are minted from the refresh token and cached per account.
const tokenCache = new Map(); // accountId → { token, expiresAt }

async function accessToken(account) {
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const cred = account.credential;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || `oauth ${res.status}`);
  tokenCache.set(account.id, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function gapi(account, path, body) {
  const cred = account.credential;
  const cid = String(cred.customerId).replace(/-/g, '');
  const res = await fetch(`${API()}/customers/${cid}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await accessToken(account)}`,
      'developer-token': cred.developerToken,
      ...(cred.loginCustomerId ? { 'login-customer-id': String(cred.loginCustomerId).replace(/-/g, '') } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || data[0]?.error?.message || `googleads ${res.status}`);
  return data;
}

const gaql = async (account, query) => (await gapi(account, '/googleAds:search', { query })).results || [];

export const googleProvider = {
  platform: 'google',

  isConfigured(account) {
    const c = account.credential || {};
    return !!(c.developerToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
  },

  async sync(account) {
    if (!this.isConfigured(account)) {
      const deltas = simulateDelivery(account, elapsedSinceSync(account));
      return Object.entries(deltas).map(([entityId, values]) => ({ entityId, kind: 'delta', values }));
    }

    // 1) Structure.
    const campaigns = await gaql(account, `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign.resource_name, campaign_budget.resource_name, campaign_budget.amount_micros
      FROM campaign WHERE campaign.status != 'REMOVED'`);
    const adGroups = await gaql(account, `
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign,
             ad_group.resource_name, ad_group.cpc_bid_micros
      FROM ad_group WHERE ad_group.status != 'REMOVED'`);
    const ads = await gaql(account, `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
             ad_group_ad.ad_group, ad_group_ad.resource_name
      FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`);

    const gStatus = (s) => (s === 'ENABLED' ? 'active' : 'paused');
    for (const r of campaigns) {
      upsertEntity(account, {
        level: 'campaign', externalId: String(r.campaign.id), parentExternalId: null,
        name: r.campaign.name, status: gStatus(r.campaign.status),
        objective: r.campaign.advertisingChannelType,
        dailyBudget: fromMicros(r.campaignBudget?.amountMicros),
        ext: { resourceName: r.campaign.resourceName, budgetResource: r.campaignBudget?.resourceName },
      });
    }
    for (const r of adGroups) {
      upsertEntity(account, {
        level: 'adset', externalId: String(r.adGroup.id),
        parentExternalId: String(r.adGroup.campaign).split('/').pop(),
        name: r.adGroup.name, status: gStatus(r.adGroup.status),
        bid: fromMicros(r.adGroup.cpcBidMicros),
        ext: { resourceName: r.adGroup.resourceName },
      });
    }
    for (const r of ads) {
      upsertEntity(account, {
        level: 'ad', externalId: String(r.adGroupAd.ad.id),
        parentExternalId: String(r.adGroupAd.adGroup).split('/').pop(),
        name: r.adGroupAd.ad.name || `${r.adGroupAd.ad.type} ${r.adGroupAd.ad.id}`,
        status: gStatus(r.adGroupAd.status),
        ext: { resourceName: r.adGroupAd.resourceName },
      });
    }

    // 2) Today's metrics at ad level.
    const stats = await gaql(account, `
      SELECT ad_group_ad.ad.id, metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.conversions_value
      FROM ad_group_ad WHERE segments.date DURING TODAY`);
    const metrics = [];
    for (const r of stats) {
      const entity = db.adEntities.find((e) => e.accountId === account.id && e.externalId === String(r.adGroupAd.ad.id));
      if (!entity) continue;
      metrics.push({
        entityId: entity.id,
        kind: 'today',
        values: {
          imp: Number(r.metrics.impressions || 0),
          clk: Number(r.metrics.clicks || 0),
          spend: fromMicros(r.metrics.costMicros) || 0,
          conv: Number(r.metrics.conversions || 0),
          rev: Number(r.metrics.conversionsValue || 0),
        },
      });
    }
    return metrics;
  },

  async apply(account, entity, action) {
    if (!this.isConfigured(account)) return; // simulated — optimizer mirrors locally
    const rn = entity.ext?.resourceName;
    if (!rn) throw new Error('missing resourceName — sync first');

    if (action.kind === 'pause' || action.kind === 'resume') {
      const status = action.kind === 'pause' ? 'PAUSED' : 'ENABLED';
      const path = { campaign: '/campaigns:mutate', adset: '/adGroups:mutate', ad: '/adGroupAds:mutate' }[entity.level];
      await gapi(account, path, {
        operations: [{ update: { resourceName: rn, status }, updateMask: 'status' }],
      });
    } else if (action.kind === 'budget') {
      const budgetRn = entity.ext?.budgetResource;
      if (!budgetRn) throw new Error('budget changes need a campaign with a budget resource');
      await gapi(account, '/campaignBudgets:mutate', {
        operations: [{ update: { resourceName: budgetRn, amountMicros: toMicros(action.to) }, updateMask: 'amount_micros' }],
      });
    } else if (action.kind === 'bid') {
      if (entity.level !== 'adset') throw new Error('bids live on ad groups');
      await gapi(account, '/adGroups:mutate', {
        operations: [{ update: { resourceName: rn, cpcBidMicros: toMicros(action.to) }, updateMask: 'cpc_bid_micros' }],
      });
    } else {
      throw new Error(`unsupported action ${action.kind}`);
    }
    log.info(`applied ${action.kind} on ${entity.name}`);
  },
};
