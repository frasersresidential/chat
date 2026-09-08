import { db } from '../store/db.js';
import { tzDayKey, tzHour, orgTimezone } from './engine.js';
import { logger } from '../logger.js';

const log = logger('ads-sim');

/**
 * Ad-delivery simulator. Accounts with no real credentials run here, so the
 * whole AI optimization loop (metrics → decisions → apply → effect) is fully
 * demonstrable with zero API keys — mirroring how chat channels fall back to
 * "simulated" mode.
 *
 * Each simulated ad carries hidden true performance traits (CTR/CVR/CPM and an
 * hour-of-day curve). Every sync tick converts the elapsed wall-clock time into
 * impressions/clicks/spend/conversions with noise. Pausing an entity stops its
 * delivery; changing budget scales it — so the AI's actions visibly move the
 * numbers.
 */

const rnd = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Diurnal curve — Thai social/search traffic: quiet at night, peaks lunch + evening.
const HOUR_CURVE = [0.2, 0.15, 0.1, 0.1, 0.15, 0.3, 0.5, 0.8, 1.0, 1.1, 1.2, 1.4,
  1.5, 1.3, 1.2, 1.2, 1.3, 1.5, 1.7, 1.9, 1.8, 1.5, 1.0, 0.5];

/** Hidden truth for one simulated ad. `quality` drives everything else. */
function makeTraits(quality) {
  return {
    quality, // 0..1 — how good this creative/audience really is
    ctr: 0.008 + quality * 0.035 + rnd(-0.002, 0.002),   // 0.8% … 4.5%
    cvr: 0.005 + quality * 0.035 + rnd(-0.002, 0.002),   // click → lead: 0.5% … 4%
    cpm: rnd(60, 170) * (1.25 - quality * 0.5),          // ฿ per 1k impressions
    fatigue: rnd(0.9, 1) - quality * 0.05,               // slow CTR decay per day
  };
}

/**
 * Build a realistic demo portfolio for a simulated account on first sync:
 * campaigns per real-estate project → ad sets (audiences) → ads (creatives).
 * Some ads are deliberately weak so the AI has something to fix.
 */
export function ensureSimPortfolio(account) {
  const existing = db.adEntities.filter((e) => e.accountId === account.id);
  if (existing.length) return existing;

  const O = account.organizationId;
  const isMeta = account.platform === 'meta';
  // `lead` = value assigned per qualified lead (ตามหลัก lead-gen: ตั้ง static
  // conversion value) — sized so a good ad lands above the 4x ROAS target and a
  // weak one clearly below it.
  const campaigns = isMeta
    ? [
      { name: 'RYM — Rhythm รัชดา | Messages', objective: 'MESSAGES', lead: 1600 },
      { name: 'LPN — Lumpini สุขุมวิท | Messages', objective: 'MESSAGES', lead: 1100 },
      { name: 'Brand Awareness Q3', objective: 'AWARENESS', lead: 700 },
    ]
    : [
      { name: 'Search — คอนโด Rhythm RYM', objective: 'SEARCH', lead: 1600 },
      { name: 'Search — คอนโด Lumpini LPN', objective: 'SEARCH', lead: 1100 },
      { name: 'PMax — โครงการพร้อมอยู่', objective: 'PMAX', lead: 800 },
    ];
  const audiences = isMeta
    ? ['Lookalike ผู้ทักแชต 1%', 'Interest คอนโด-การลงทุน', 'Retargeting เว็บ 30 วัน']
    : ['กลุ่มคำหลัก ราคา/โปร', 'กลุ่มคำหลัก ทำเล', 'กลุ่มคำหลัก แบรนด์'];
  const creatives = ['วิดีโอห้องตัวอย่าง', 'โปรฟรีทุกค่าใช้จ่าย', 'ภาพชุด ส่วนกลาง', 'รีวิวลูกบ้าน'];

  const rows = [];
  campaigns.forEach((c, ci) => {
    const camp = db.adEntities.insert({
      organizationId: O, accountId: account.id, platform: account.platform,
      level: 'campaign', externalId: `sim_c_${account.id}_${ci}`, parentId: null,
      name: c.name, status: 'active', objective: c.objective,
      dailyBudget: account.platform === 'google' ? rnd(800, 2000) : null,
      bid: null, sim: { leadValue: c.lead * rnd(0.8, 1.2) },
    });
    rows.push(camp);
    const nSets = 2;
    for (let si = 0; si < nSets; si++) {
      const campTag = (c.name.split('—')[1] || c.name).split('|')[0].trim();
      const adset = db.adEntities.insert({
        organizationId: O, accountId: account.id, platform: account.platform,
        level: 'adset', externalId: `sim_s_${account.id}_${ci}_${si}`, parentId: camp.id,
        name: `${campTag} · ${audiences[(ci + si) % audiences.length]}`,
        status: 'active', objective: c.objective,
        dailyBudget: isMeta ? Math.round(rnd(400, 1200)) : null,
        bid: isMeta ? null : Math.round(rnd(8, 25)),
        sim: {},
      });
      rows.push(adset);
      const nAds = 2 + (si === 0 ? 1 : 0);
      for (let ai = 0; ai < nAds; ai++) {
        // First campaign's first ad set gets one deliberately weak creative,
        // and one strong one — a visible A/B story for the optimizer.
        const quality = (ci === 0 && si === 0)
          ? (ai === 0 ? rnd(0.75, 0.95) : ai === 1 ? rnd(0.05, 0.18) : rnd(0.4, 0.6))
          : rnd(0.2, 0.85);
        rows.push(db.adEntities.insert({
          organizationId: O, accountId: account.id, platform: account.platform,
          level: 'ad', externalId: `sim_a_${account.id}_${ci}_${si}_${ai}`, parentId: adset.id,
          name: `${pick(creatives)} #${ci + 1}${String.fromCharCode(65 + ai)}`,
          status: 'active', objective: c.objective, dailyBudget: null, bid: null,
          sim: makeTraits(quality),
        }));
      }
    }
  });
  log.info(`simulated portfolio created for ${account.name}: ${rows.length} entities`);
  backfillHistory(account);
  return rows;
}

/**
 * Seed 7 days of daily rollups + today's hour-by-hour history for a freshly
 * created simulated portfolio, so the dashboard has charts/baselines and the
 * optimizer can make decisions from the very first cycle.
 */
function backfillHistory(account) {
  const tz = orgTimezone(account.organizationId);
  const now = new Date();
  const hourNow = tzHour(tz, now);
  const entities = db.adEntities.filter((e) => e.accountId === account.id);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const ads = entities.filter((e) => e.level === 'ad');
  const curveSum = HOUR_CURVE.reduce((a, b) => a + b, 0);

  const shareOf = new Map();
  const weight = (ad) => 0.35 + (ad.sim?.quality ?? 0.5);
  for (const ad of ads) {
    const total = ads.filter((a) => a.parentId === ad.parentId).reduce((s, a) => s + weight(a), 0) || 1;
    shareOf.set(ad.id, weight(ad) / total);
  }

  for (const ad of ads) {
    const t = ad.sim || makeTraits(0.5);
    const budget = adBudget(ad, byId);
    const slice = (fraction) => {
      const spend = budget * shareOf.get(ad.id) * fraction * rnd(0.75, 1.2);
      const imp = Math.max(0, Math.round((spend / t.cpm) * 1000));
      const clk = binomialish(imp, t.ctr);
      const conv = binomialish(clk, t.cvr);
      const campaign = topAncestor(ad, byId);
      const rev = Math.round(conv * (campaign?.sim?.leadValue ?? 1500) * rnd(0.85, 1.15));
      return { imp, clk, spend: round2(spend), conv, rev };
    };

    const days = {};
    for (let d = 7; d >= 1; d--) {
      days[tzDayKey(tz, new Date(now.getTime() - d * 86400000))] = slice(rnd(0.85, 1.05));
    }
    const points = [];
    const today = { date: tzDayKey(tz, now), imp: 0, clk: 0, spend: 0, conv: 0, rev: 0 };
    for (let h = 0; h <= hourNow; h++) {
      const p = slice(HOUR_CURVE[h] / curveSum);
      points.push({ t: new Date(now.getTime() - (hourNow - h) * 3600000).toISOString(), ...p });
      for (const f of ['imp', 'clk', 'spend', 'conv', 'rev']) today[f] = round2(today[f] + p[f]);
    }
    db.adMetrics.insert({
      id: ad.id, organizationId: account.organizationId, accountId: account.id,
      points, today, days,
    });
  }
}

/** Effective daily budget for an ad: its budget-bearing ancestor's budget. */
function adBudget(ad, byId) {
  let cur = ad;
  while (cur) {
    if (cur.dailyBudget != null) return cur.dailyBudget;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return 500;
}

function isDeliverable(entity, byId) {
  let cur = entity;
  while (cur) {
    if (cur.status !== 'active') return false;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return true;
}

/**
 * Advance the simulation for `elapsedMs` of wall-clock time and return metric
 * deltas per ad entity: { [entityId]: {imp, clk, spend, conv, rev} }.
 */
export function simulateDelivery(account, elapsedMs) {
  ensureSimPortfolio(account);
  const entities = db.adEntities.filter((e) => e.accountId === account.id);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const ads = entities.filter((e) => e.level === 'ad');
  const hour = new Date().getHours();
  const hourMult = HOUR_CURVE[hour] ?? 1;
  const dayFrac = Math.min(elapsedMs, 30 * 60000) / 86400000; // cap catch-up at 30 min

  // Ads in one ad set share its budget. Platforms favour winners but keep
  // exploring weak ads too — weight = 0.35 + quality.
  const weight = (ad) => 0.35 + (ad.sim?.quality ?? 0.5);
  const siblings = new Map(); // adsetId → total weight of active ads
  for (const ad of ads) {
    if (!isDeliverable(ad, byId)) continue;
    siblings.set(ad.parentId, (siblings.get(ad.parentId) || 0) + weight(ad));
  }

  const deltas = {};
  for (const ad of ads) {
    if (!isDeliverable(ad, byId)) continue;
    const t = ad.sim || makeTraits(0.5);
    const budget = adBudget(ad, byId);
    const share = weight(ad) / (siblings.get(ad.parentId) || 1);
    // Spend the day's budget along the hour curve, with noise.
    const spend = budget * share * dayFrac * hourMult * rnd(0.7, 1.3);
    if (spend <= 0) continue;
    const imp = Math.max(1, Math.round((spend / t.cpm) * 1000));
    const clk = binomialish(imp, t.ctr * hourNoise());
    const conv = binomialish(clk, t.cvr);
    const campaign = topAncestor(ad, byId);
    const leadValue = campaign?.sim?.leadValue ?? 1100;
    const rev = conv * leadValue * rnd(0.85, 1.15);
    deltas[ad.id] = {
      imp, clk, conv,
      spend: round2(spend),
      rev: Math.round(rev),
    };
  }
  return deltas;
}

function topAncestor(e, byId) {
  let cur = e;
  while (cur?.parentId) cur = byId.get(cur.parentId);
  return cur;
}
const hourNoise = () => rnd(0.85, 1.15);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Cheap, unbiased binomial approximation. Small means use floor+bernoulli so
 * clamping at zero doesn't inflate rare events (conversions especially).
 */
function binomialish(n, p) {
  const mean = n * p;
  if (mean < 8) {
    let k = Math.floor(mean);
    if (Math.random() < mean - k) k++;
    return k;
  }
  return Math.max(0, Math.round(mean + (Math.random() - 0.5) * Math.sqrt(mean) * 2));
}
