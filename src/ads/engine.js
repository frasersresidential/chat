import { db } from '../store/db.js';

/**
 * Metrics engine. One `adMetrics` row per ad entity (id === entity id) holding:
 *   points  — recent per-tick deltas [{t, imp, clk, spend, conv, rev}] (capped)
 *   today   — running totals since midnight (org timezone)
 *   days    — daily rollups keyed by YYYY-MM-DD (capped)
 * Live providers report cumulative "today" numbers (we diff them); the
 * simulator reports deltas directly. Parents (ad sets / campaigns) aggregate
 * their descendant ads on read — only ads carry raw metrics.
 */

const MAX_POINTS = 600; // ≈10 h at 1-min ticks
const MAX_DAYS = 35;

const ZERO = () => ({ imp: 0, clk: 0, spend: 0, conv: 0, rev: 0 });
const FIELDS = ['imp', 'clk', 'spend', 'conv', 'rev'];
const addInto = (a, b) => { for (const f of FIELDS) a[f] = round2((a[f] || 0) + (b[f] || 0)); return a; };
const round2 = (n) => Math.round(n * 100) / 100;

/** YYYY-MM-DD in the org's timezone (falls back to Asia/Bangkok). */
export function tzDayKey(tz, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Bangkok' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Current hour (0–23) in the org's timezone — used for pacing & dayparting. */
export function tzHour(tz, date = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Bangkok', hour: 'numeric', hour12: false }).format(date));
  } catch {
    return date.getHours();
  }
}

export function orgTimezone(orgId) {
  return db.organizations.get(orgId)?.businessHours?.timezone || 'Asia/Bangkok';
}

/** Ingest one sync's metric rows for an account. */
export function ingestMetrics(account, metricRows, now = new Date()) {
  const dayKey = tzDayKey(orgTimezone(account.organizationId), now);
  for (const { entityId, kind, values } of metricRows) {
    let row = db.adMetrics.get(entityId);
    if (!row) {
      row = db.adMetrics.insert({
        id: entityId,
        organizationId: account.organizationId,
        accountId: account.id,
        points: [], today: { date: dayKey, ...ZERO() }, days: {},
      });
    }
    const today = { ...row.today };
    const days = { ...row.days };

    // Midnight rollover → archive yesterday, start fresh.
    if (today.date !== dayKey) {
      if (today.imp || today.spend) days[today.date] = { ...today };
      Object.assign(today, ZERO(), { date: dayKey });
    }

    let delta;
    if (kind === 'delta') {
      delta = values;
      addInto(today, values);
    } else {
      // Cumulative "today" from a live API — diff against what we already saw.
      delta = {};
      let reset = false;
      for (const f of FIELDS) if ((values[f] || 0) < (today[f] || 0) - 0.01) reset = true;
      for (const f of FIELDS) {
        delta[f] = reset ? (values[f] || 0) : round2(Math.max(0, (values[f] || 0) - (today[f] || 0)));
        today[f] = round2(values[f] || 0);
      }
    }

    const points = [...row.points, { t: now.toISOString(), ...delta }];
    if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
    const dayKeys = Object.keys(days).sort();
    while (dayKeys.length > MAX_DAYS) delete days[dayKeys.shift()];

    db.adMetrics.update(entityId, { points, today, days });
  }
}

/** Derived KPIs from raw totals. */
export function kpisOf(m) {
  const imp = m.imp || 0, clk = m.clk || 0, spend = m.spend || 0, conv = m.conv || 0, rev = m.rev || 0;
  return {
    ...m, imp, clk, spend: round2(spend), conv, rev: round2(rev),
    ctr: imp ? round2((clk / imp) * 100) : 0,          // %
    cpc: clk ? round2(spend / clk) : null,
    cpm: imp ? round2((spend / imp) * 1000) : null,
    cpa: conv ? round2(spend / conv) : null,           // ฿/lead
    roas: spend ? round2(rev / spend) : null,          // rev ÷ spend
  };
}

/** All descendant ad-level entity ids of an entity (itself if it's an ad). */
export function descendantAdIds(entity, all) {
  if (entity.level === 'ad') return [entity.id];
  const children = all.filter((e) => e.parentId === entity.id);
  return children.flatMap((c) => descendantAdIds(c, all));
}

/** Today's aggregated totals for any entity (ads roll up into parents). */
export function todayTotals(entity, all) {
  const total = ZERO();
  for (const id of descendantAdIds(entity, all)) {
    const row = db.adMetrics.get(id);
    if (row) addInto(total, row.today);
  }
  return total;
}

/** Sum of point deltas within the last `minutes` for a set of ad ids. */
export function windowTotals(adIds, minutes, now = Date.now()) {
  const cutoff = now - minutes * 60000;
  const total = ZERO();
  for (const id of adIds) {
    const row = db.adMetrics.get(id);
    if (!row) continue;
    for (let i = row.points.length - 1; i >= 0; i--) {
      const p = row.points[i];
      if (new Date(p.t).getTime() < cutoff) break;
      addInto(total, p);
    }
  }
  return total;
}

/** Average daily totals over the archived days (7-day-style baseline). */
export function dailyBaseline(adIds, maxDays = 7) {
  const total = ZERO();
  let n = 0;
  const perDay = {};
  for (const id of adIds) {
    const row = db.adMetrics.get(id);
    if (!row) continue;
    for (const [d, v] of Object.entries(row.days)) perDay[d] = addInto(perDay[d] || ZERO(), v);
  }
  for (const d of Object.keys(perDay).sort().slice(-maxDays)) { addInto(total, perDay[d]); n++; }
  if (!n) return null;
  for (const f of FIELDS) total[f] = round2(total[f] / n);
  return total;
}

/** Hourly buckets for the dashboard chart (org-wide, last `hours`). Each bucket
 * carries its end timestamp `t` — the client renders it in local time. */
export function orgHourlySeries(orgId, hours = 12, now = Date.now()) {
  const buckets = [];
  for (let i = hours - 1; i >= 0; i--) {
    const start = now - (i + 1) * 3600000;
    buckets.push({ start, end: start + 3600000, ...ZERO() });
  }
  for (const row of db.adMetrics.filter((m) => m.organizationId === orgId)) {
    for (const p of row.points) {
      const t = new Date(p.t).getTime();
      const b = buckets.find((x) => t >= x.start && t < x.end);
      if (b) addInto(b, p);
    }
  }
  return buckets.map(({ start, end, ...rest }) => ({ t: end, ...rest }));
}

/** Org-wide today totals + KPIs across every ads account. */
export function orgTodayKpis(orgId) {
  const total = ZERO();
  for (const row of db.adMetrics.filter((m) => m.organizationId === orgId)) addInto(total, row.today);
  return kpisOf(total);
}
