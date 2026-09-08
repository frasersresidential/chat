import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { seedIfEmpty } from '../src/store/seed.js';
import {
  defaultAdsPolicy, sanitizeAdsPolicy, decideActions, executeIntent,
  resolveSuggestion, manualAction, runAdsCycle,
} from '../src/ads/optimizer.js';
import { ingestMetrics, tzDayKey, tzHour, orgTimezone, kpisOf, todayTotals } from '../src/ads/engine.js';

db._reset();
seedIfEmpty();

const org = db.organizations.get('org_company_a');
const account = db.adAccounts.get('adacc_meta_demo');
const tz = orgTimezone(org.id);
const owner = db.users.get('u_owner');

/** Deterministic fixture: campaign → ad set (budget) → ads with fixed metrics. */
function clearAdsData() {
  for (const e of db.adEntities.all()) db.adEntities.remove(e.id);
  for (const m of db.adMetrics.all()) db.adMetrics.remove(m.id);
  for (const a of db.adActions.all()) db.adActions.remove(a.id);
}
let seq = 0;
function mkEntity(over = {}) {
  return db.adEntities.insert({
    organizationId: org.id, accountId: account.id, platform: 'meta',
    externalId: 'x' + (++seq), status: 'active', parentId: null,
    dailyBudget: null, bid: null, ...over,
  });
}
function setToday(entityId, today) {
  db.adMetrics.insert({
    id: entityId, organizationId: org.id, accountId: account.id,
    points: [], today: { date: tzDayKey(tz), imp: 0, clk: 0, spend: 0, conv: 0, rev: 0, ...today }, days: {},
  });
}
/** Policy with alerts/dayparting off so decisions are time-independent. */
function quietPolicy(over = {}) {
  return {
    ...defaultAdsPolicy(),
    alerts: { spendSpike: false, ctrDrop: false, zeroDelivery: false },
    dayparting: { enabled: false, start: 8, end: 22 },
    ...over,
  };
}

beforeEach(() => clearAdsData());

test('sanitizeAdsPolicy clamps values and rejects junk', () => {
  const p = sanitizeAdsPolicy({ mode: 'yolo', intervalSec: 1, maxBudgetChangePct: 500, targetCpa: 'abc' });
  assert.equal(p.mode, 'auto');            // invalid mode → keep default
  assert.equal(p.intervalSec, 30);         // clamped to floor
  assert.equal(p.maxBudgetChangePct, 100); // clamped to cap
  assert.equal(p.targetCpa, defaultAdsPolicy().targetCpa);
});

test('AI pauses an ad whose CPA blows past target (cpa_kill)', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  // CPA = 1000/1 = ฿1000 > 400 × 1.8
  setToday(ad.id, { imp: 9000, clk: 200, spend: 1000, conv: 1, rev: 500 });
  const intents = decideActions(org, quietPolicy());
  const kill = intents.find((i) => i.rule === 'cpa_kill');
  assert.ok(kill, 'expected a cpa_kill intent');
  assert.equal(kill.kind, 'pause');
  assert.equal(kill.entityId, adset.id); // ad set spend ≥ 2×minSpend → adset evaluated first
});

test('spend with zero conversions triggers burn_no_conv pause', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 5000, clk: 100, spend: 700, conv: 0, rev: 0 });
  const intents = decideActions(org, quietPolicy());
  assert.ok(intents.find((i) => i.rule === 'burn_no_conv' && i.kind === 'pause'));
});

test('no pause/scale decisions below minimum spend (data guard)', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 300, clk: 5, spend: 90, conv: 0, rev: 0 }); // under ฿300
  const intents = decideActions(org, quietPolicy());
  assert.equal(intents.filter((i) => i.kind !== 'alert').length, 0);
});

test('winning ad set gets a budget increase capped by maxBudgetChangePct and budgetCap', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 10000, clk: 300, spend: 450, conv: 5, rev: 4000 }); // ROAS 8.9 ≥ 4×1.15
  let intents = decideActions(org, quietPolicy());
  const up = intents.find((i) => i.rule === 'scale_up');
  assert.ok(up);
  assert.equal(up.to, 600); // +20% of 500

  // Near the cap → clamped to budgetCap, never beyond.
  db.adEntities.update(adset.id, { dailyBudget: 9500 });
  intents = decideActions(org, quietPolicy());
  assert.equal(intents.find((i) => i.rule === 'scale_up').to, 10000);
});

test('losing ad set gets scaled down but never below budgetFloor', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  // ROAS 1.1 < 4×0.5, CPA 160 fine → still losing by ROAS
  setToday(ad.id, { imp: 10000, clk: 300, spend: 480, conv: 3, rev: 530 });
  const intents = decideActions(org, quietPolicy());
  const down = intents.find((i) => i.rule === 'scale_down');
  assert.ok(down);
  assert.equal(down.to, 400); // −20%

  db.adEntities.update(adset.id, { dailyBudget: 110 });
  const again = decideActions(org, quietPolicy());
  const clamped = again.find((i) => i.rule === 'scale_down');
  assert.equal(clamped.to, 100); // floor
});

test('cooldown blocks repeat changes on the same entity', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({
    level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500,
    ai: { last: { budget: new Date().toISOString() } },
  });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 10000, clk: 300, spend: 450, conv: 5, rev: 4000 });
  const intents = decideActions(org, quietPolicy());
  assert.equal(intents.find((i) => i.rule === 'scale_up'), undefined);
});

test('A/B losing creative is paused (ab_loser), never the last active ad', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const strong = mkEntity({ level: 'ad', name: 'ชนะ', parentId: adset.id });
  const weak = mkEntity({ level: 'ad', name: 'แพ้', parentId: adset.id });
  setToday(strong.id, { imp: 2000, clk: 80, spend: 100, conv: 2, rev: 1500 }); // CTR 4%
  setToday(weak.id, { imp: 2000, clk: 20, spend: 100, conv: 1, rev: 700 });    // CTR 1%
  const intents = decideActions(org, quietPolicy());
  const loser = intents.find((i) => i.rule === 'ab_loser');
  assert.ok(loser);
  assert.equal(loser.entityId, weak.id);
});

test('aiExcluded entities are never touched', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500, aiExcluded: true });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id, aiExcluded: true });
  setToday(ad.id, { imp: 9000, clk: 200, spend: 1000, conv: 0, rev: 0 });
  const intents = decideActions(org, quietPolicy());
  assert.equal(intents.filter((i) => i.kind !== 'alert').length, 0);
});

test('dayparting pauses outside hours and resumes inside', async () => {
  const hour = tzHour(tz);
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });

  // Force "outside hours" (a window that excludes the current hour).
  const outside = quietPolicy({ dayparting: { enabled: true, start: (hour + 2) % 23, end: ((hour + 2) % 23) + 1 } });
  const offIntent = decideActions(org, outside).find((i) => i.rule === 'daypart_off');
  assert.ok(offIntent);
  await executeIntent(org, outside, offIntent);
  assert.equal(db.adEntities.get(adset.id).status, 'paused');
  assert.equal(db.adEntities.get(adset.id).ai.pausedBy, 'daypart_off');

  // Now "inside hours" → the daypart-paused entity is resumed.
  const inside = quietPolicy({ dayparting: { enabled: true, start: hour, end: Math.min(24, hour + 1) } });
  const onIntent = decideActions(org, inside).find((i) => i.rule === 'daypart_on');
  assert.ok(onIntent);
  await executeIntent(org, inside, onIntent);
  assert.equal(db.adEntities.get(adset.id).status, 'active');
});

test('spend pacing anomaly raises an alert without mutating anything', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 300 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 8000, clk: 250, spend: 450, conv: 2, rev: 2400 }); // 450 > 300×1.3
  const policy = quietPolicy({ alerts: { spendSpike: true, ctrDrop: false, zeroDelivery: false } });
  const alert = decideActions(org, policy).find((i) => i.rule === 'spend_spike');
  assert.ok(alert);
  assert.equal(alert.kind, 'alert');
});

test('suggest mode queues actions; approval applies them; rejection does not', async () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const ad = mkEntity({ level: 'ad', name: 'A1', parentId: adset.id });
  setToday(ad.id, { imp: 10000, clk: 300, spend: 450, conv: 5, rev: 4000 });
  const policy = quietPolicy({ mode: 'suggest' });

  const intent = decideActions(org, policy).find((i) => i.rule === 'scale_up');
  const action = await executeIntent(org, policy, intent);
  assert.equal(action.status, 'suggested');
  assert.equal(db.adEntities.get(adset.id).dailyBudget, 500); // untouched

  // Duplicate suggestion for the same entity+rule is not created again.
  assert.equal(await executeIntent(org, policy, intent), null);

  const approved = await resolveSuggestion(action.id, owner, true);
  assert.equal(approved.status, 'applied');
  assert.equal(db.adEntities.get(adset.id).dailyBudget, 600);

  // A rejected suggestion never touches the entity.
  const intent2 = { ...intent, rule: 'scale_up2' };
  const action2 = await executeIntent(org, policy, intent2);
  const rejected = await resolveSuggestion(action2.id, owner, false);
  assert.equal(rejected.status, 'rejected');
  assert.equal(db.adEntities.get(adset.id).dailyBudget, 600);
});

test('maxActionsPerCycle caps mutations but alerts still pass', () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  for (let i = 0; i < 4; i++) {
    const adset = mkEntity({ level: 'adset', name: 'S' + i, parentId: camp.id, dailyBudget: 300 });
    const ad = mkEntity({ level: 'ad', name: 'A' + i, parentId: adset.id });
    setToday(ad.id, { imp: 10000, clk: 300, spend: 450, conv: 5, rev: 4000 }); // all winners + overspending
  }
  const policy = quietPolicy({ maxActionsPerCycle: 2, alerts: { spendSpike: true, ctrDrop: false, zeroDelivery: false } });
  const intents = decideActions(org, policy);
  assert.equal(intents.filter((i) => i.kind !== 'alert').length, 2);
  assert.equal(intents.filter((i) => i.kind === 'alert').length, 4);
});

test('manual action applies immediately and lands in the audit log', async () => {
  const camp = mkEntity({ level: 'campaign', name: 'C1' });
  const adset = mkEntity({ level: 'adset', name: 'S1', parentId: camp.id, dailyBudget: 500 });
  const action = await manualAction(owner, db.adEntities.get(adset.id), { kind: 'pause' });
  assert.equal(action.status, 'applied');
  assert.equal(action.source, 'manual');
  assert.equal(db.adEntities.get(adset.id).status, 'paused');
});

test('engine diffs cumulative "today" metrics from live APIs', () => {
  const ad = mkEntity({ level: 'ad', name: 'A1' });
  ingestMetrics(account, [{ entityId: ad.id, kind: 'today', values: { imp: 100, clk: 10, spend: 50, conv: 1, rev: 500 } }]);
  ingestMetrics(account, [{ entityId: ad.id, kind: 'today', values: { imp: 150, clk: 12, spend: 80, conv: 2, rev: 900 } }]);
  const row = db.adMetrics.get(ad.id);
  assert.equal(row.today.imp, 150);
  assert.equal(row.points.length, 2);
  assert.equal(row.points[1].imp, 50); // the delta, not the cumulative value
  assert.equal(row.points[1].spend, 30);
});

test('full cycle on the simulated portfolio produces data and stays within caps', async () => {
  // Fresh simulated portfolio (no fixture): sync generates entities + backfill.
  const result = await runAdsCycle(org);
  assert.ok(db.adEntities.all().length > 0, 'portfolio created');
  assert.ok(db.adMetrics.all().length > 0, 'metrics ingested');
  const policy = quietPolicy();
  const mutations = result.actions.filter((a) => a.kind !== 'alert');
  assert.ok(mutations.length <= policy.maxActionsPerCycle);
  // Every applied mutation carries a Thai reason for the audit log.
  for (const a of result.actions) assert.ok(a.reason && a.reason.length > 5);
});
