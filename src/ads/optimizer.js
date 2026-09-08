import { db } from '../store/db.js';
import { bus } from '../core/eventBus.js';
import { notify } from '../core/notifications.js';
import { can, PERMISSIONS } from '../core/rbac.js';
import { getAdsProvider } from './providers/index.js';
import {
  ingestMetrics, kpisOf, todayTotals, descendantAdIds, windowTotals,
  dailyBaseline, tzHour, tzDayKey, orgTimezone, orgTodayKpis,
} from './engine.js';
import { logger } from '../logger.js';

const log = logger('ads-ai');

/**
 * The real-time AI optimization engine.
 *
 * Every cycle it syncs fresh metrics from each connected ad platform, then runs
 * the decision rules below over every campaign / ad set / ad. Decisions become
 * actions: applied immediately (mode "auto") or queued for human approval
 * (mode "suggest"). Every action carries a Thai-language reason and lands in
 * the audit log + the live WebSocket feed.
 *
 * Rules (in priority order), all guarded by minimum-data thresholds, per-entity
 * cooldowns and budget floors/caps so the AI can never run away:
 *   pause      — CPA blown past target, or spend with zero conversions
 *   rotate     — A/B losing creative (CTR less than half of the best sibling)
 *   budget ↑/↓ — scale winners up / losers down by at most maxBudgetChangePct
 *   bid ↕      — nudge manual bids toward target CPA
 *   daypart    — pause/resume delivery outside configured hours
 *   alert      — anomalies (overspend pacing, CTR collapse, zero delivery)
 */

export function defaultAdsPolicy() {
  return {
    enabled: true,
    mode: 'auto',              // 'auto' apply | 'suggest' queue for approval
    intervalSec: 60,           // optimization heartbeat
    targetCpa: 400,            // ฿ per lead
    targetRoas: 4,             // revenue ÷ spend
    minSpendForDecision: 300,  // ฿ before pause/scale decisions kick in
    minImpressions: 600,       // before CTR judgements
    maxBudgetChangePct: 20,    // per adjustment
    budgetFloor: 100,          // ฿/day
    budgetCap: 10000,          // ฿/day
    cooldownMin: 60,           // between changes on the same entity
    maxActionsPerCycle: 8,
    autoPause: true, autoBudget: true, autoBid: true, autoRotate: true,
    dayparting: { enabled: false, start: 8, end: 22 },
    alerts: { spendSpike: true, ctrDrop: true, zeroDelivery: true },
  };
}

export function sanitizeAdsPolicy(body = {}, cur = defaultAdsPolicy()) {
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const boolOr = (v, fallback) => (v === undefined ? fallback : !!v);
  return {
    enabled: boolOr(body.enabled, cur.enabled),
    mode: ['auto', 'suggest'].includes(body.mode) ? body.mode : cur.mode,
    intervalSec: num(body.intervalSec, cur.intervalSec, 30, 3600),
    targetCpa: num(body.targetCpa, cur.targetCpa, 1, 1e7),
    targetRoas: num(body.targetRoas, cur.targetRoas, 0.1, 1000),
    minSpendForDecision: num(body.minSpendForDecision, cur.minSpendForDecision, 0, 1e7),
    minImpressions: num(body.minImpressions, cur.minImpressions, 0, 1e9),
    maxBudgetChangePct: num(body.maxBudgetChangePct, cur.maxBudgetChangePct, 1, 100),
    budgetFloor: num(body.budgetFloor, cur.budgetFloor, 0, 1e7),
    budgetCap: num(body.budgetCap, cur.budgetCap, 1, 1e8),
    cooldownMin: num(body.cooldownMin, cur.cooldownMin, 0, 1440),
    maxActionsPerCycle: num(body.maxActionsPerCycle, cur.maxActionsPerCycle, 1, 50),
    autoPause: boolOr(body.autoPause, cur.autoPause),
    autoBudget: boolOr(body.autoBudget, cur.autoBudget),
    autoBid: boolOr(body.autoBid, cur.autoBid),
    autoRotate: boolOr(body.autoRotate, cur.autoRotate),
    dayparting: {
      enabled: boolOr(body.dayparting?.enabled, cur.dayparting.enabled),
      start: num(body.dayparting?.start, cur.dayparting.start, 0, 23),
      end: num(body.dayparting?.end, cur.dayparting.end, 1, 24),
    },
    alerts: {
      spendSpike: boolOr(body.alerts?.spendSpike, cur.alerts.spendSpike),
      ctrDrop: boolOr(body.alerts?.ctrDrop, cur.alerts.ctrDrop),
      zeroDelivery: boolOr(body.alerts?.zeroDelivery, cur.alerts.zeroDelivery),
    },
  };
}

export const orgAdsPolicy = (org) => ({ ...defaultAdsPolicy(), ...(org?.adsPolicy || {}) });

const fmt = (n) => Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isoNow = () => new Date().toISOString();

function underCooldown(entity, kind, cooldownMin, now = Date.now()) {
  const last = entity.ai?.last?.[kind];
  return !!last && now - new Date(last).getTime() < cooldownMin * 60000;
}

function openSuggestionExists(entityId, rule) {
  return !!db.adActions.find((a) => a.entityId === entityId && a.rule === rule && a.status === 'suggested');
}

function alertedToday(entityId, rule, dayKey) {
  return !!db.adActions.find((a) => a.entityId === entityId && a.rule === rule &&
    a.kind === 'alert' && (a.createdAt || '').startsWith(dayKey));
}

const activeWithAncestors = (e, byId) => {
  let cur = e;
  while (cur) {
    if (cur.status !== 'active') return false;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return true;
};

/**
 * Pure decision pass — inspects the store and returns action intents without
 * touching anything. Exported for tests.
 */
export function decideActions(org, policy, now = new Date()) {
  const tz = orgTimezone(org.id);
  const hour = tzHour(tz, now);
  const dayKey = tzDayKey(tz, now);
  const intents = [];
  const pausedThisPass = new Set();

  const push = (account, entity, intent) => intents.push({
    accountId: account.id, entityId: entity.id, entityName: entity.name,
    entityLevel: entity.level, platform: account.platform, ...intent,
  });

  for (const account of db.adAccounts.filter((a) => a.organizationId === org.id && a.status === 'active')) {
    const all = db.adEntities.filter((e) => e.accountId === account.id);
    const byId = new Map(all.map((e) => [e.id, e]));
    const budgetBearing = all.filter((e) => e.dailyBudget != null);

    // ── Dayparting: outside configured hours → pause; inside → resume ──────
    if (policy.dayparting.enabled) {
      const inHours = hour >= policy.dayparting.start && hour < policy.dayparting.end;
      for (const e of budgetBearing) {
        if (e.aiExcluded) continue;
        if (!inHours && e.status === 'active') {
          push(account, e, {
            kind: 'pause', rule: 'daypart_off', severity: 'info', confidence: 1,
            reason: `นอกช่วงเวลายิงแอด (${policy.dayparting.start}:00–${policy.dayparting.end}:00) → พักการยิงชั่วคราว`,
          });
          pausedThisPass.add(e.id);
        } else if (inHours && e.status === 'paused' && e.ai?.pausedBy === 'daypart_off') {
          push(account, e, {
            kind: 'resume', rule: 'daypart_on', severity: 'info', confidence: 1,
            reason: `เข้าเวลายิงแอด (${policy.dayparting.start}:00) → เปิดการยิงต่อ`,
          });
        }
      }
    }

    // ── Pause losers (evaluate ad sets before their ads to avoid doubles) ──
    const pauseCandidates = [
      ...all.filter((e) => e.level === 'adset'),
      ...all.filter((e) => e.level === 'ad'),
    ];
    for (const e of pauseCandidates) {
      if (e.aiExcluded || !activeWithAncestors(e, byId) || pausedThisPass.has(e.id)) continue;
      if (e.parentId && pausedThisPass.has(e.parentId)) continue;
      if (underCooldown(e, 'pause', policy.cooldownMin)) continue;
      const minSpend = e.level === 'adset' ? policy.minSpendForDecision * 2 : policy.minSpendForDecision;
      const k = kpisOf(todayTotals(e, all));
      if (k.spend < minSpend) continue;

      let intent = null;
      if (k.conv === 0 && k.spend >= Math.max(minSpend, policy.targetCpa * 1.5)) {
        intent = {
          rule: 'burn_no_conv', severity: 'critical',
          confidence: Math.min(0.95, 0.5 + k.spend / (policy.targetCpa * 6)),
          reason: `ใช้งบไปแล้ว ฿${fmt(k.spend)} วันนี้ แต่ยังไม่มี lead เลย → หยุดเพื่อตัดงบเสีย`,
        };
      } else if (k.cpa != null && k.cpa > policy.targetCpa * 1.8) {
        intent = {
          rule: 'cpa_kill', severity: 'critical',
          confidence: Math.min(0.95, 0.5 + (k.cpa / policy.targetCpa - 1.8) / 3),
          reason: `CPA ฿${fmt(k.cpa)} แพงกว่าเป้า ฿${fmt(policy.targetCpa)} เกิน 80% (ใช้ไป ฿${fmt(k.spend)} / ${k.conv} lead) → หยุดชั่วคราว`,
        };
      }
      if (intent) {
        push(account, e, { kind: 'pause', metrics: k, ...intent });
        pausedThisPass.add(e.id);
      }
    }

    // ── Creative rotation: pause the clearly losing A/B sibling ────────────
    for (const adset of all.filter((e) => e.level === 'adset')) {
      if (adset.aiExcluded || pausedThisPass.has(adset.id) || !activeWithAncestors(adset, byId)) continue;
      const siblings = all.filter((a) => a.parentId === adset.id && a.level === 'ad' &&
        a.status === 'active' && !a.aiExcluded && !pausedThisPass.has(a.id));
      if (siblings.length < 2) continue;
      const scored = siblings
        .map((a) => ({ a, k: kpisOf(todayTotals(a, all)) }))
        .filter((x) => x.k.imp >= policy.minImpressions);
      if (scored.length < 2) continue;
      scored.sort((x, y) => y.k.ctr - x.k.ctr);
      const best = scored[0], worst = scored[scored.length - 1];
      if (worst.k.ctr > 0 && best.k.ctr / worst.k.ctr >= 2 && !underCooldown(worst.a, 'pause', policy.cooldownMin)) {
        push(account, worst.a, {
          kind: 'pause', rule: 'ab_loser', severity: 'warn', metrics: worst.k,
          confidence: Math.min(0.9, 0.5 + best.k.ctr / worst.k.ctr / 10),
          reason: `แพ้ A/B test: CTR ${fmt(worst.k.ctr)}% ต่ำกว่าครีเอทีฟที่ดีที่สุดใน ad set (${fmt(best.k.ctr)}%) เกินเท่าตัว → หยุดตัวแพ้ ให้บประมาณไหลไปตัวชนะ`,
        });
        pausedThisPass.add(worst.a.id);
      }
    }

    // ── Budget scaling on budget-bearing entities ──────────────────────────
    for (const e of budgetBearing) {
      if (e.aiExcluded || !activeWithAncestors(e, byId) || pausedThisPass.has(e.id)) continue;
      if (underCooldown(e, 'budget', policy.cooldownMin)) continue;
      const k = kpisOf(todayTotals(e, all));
      if (k.spend < policy.minSpendForDecision) continue;
      const step = policy.maxBudgetChangePct / 100;

      // When revenue is tracked, ROAS is the business truth; CPA only decides
      // for accounts that don't assign conversion values.
      const roasKnown = k.roas != null && k.rev > 0;
      const winning = roasKnown
        ? k.roas >= policy.targetRoas * 1.15
        : (k.cpa != null && k.conv >= 3 && k.cpa <= policy.targetCpa * 0.6);
      const losing = roasKnown
        ? k.roas < policy.targetRoas * 0.5
        : (k.cpa != null && k.cpa > policy.targetCpa * 1.3);

      if (winning) {
        const to = Math.min(policy.budgetCap, Math.round(e.dailyBudget * (1 + step)));
        if (to > e.dailyBudget) {
          push(account, e, {
            kind: 'budget', from: e.dailyBudget, to, rule: 'scale_up', severity: 'info', metrics: k,
            confidence: Math.min(0.9, 0.55 + (k.roas || 0) / (policy.targetRoas * 10)),
            reason: `ทำผลงานดี (ROAS ${fmt(k.roas)}x${k.cpa != null ? ` · CPA ฿${fmt(k.cpa)}` : ''} เทียบเป้า ${fmt(policy.targetRoas)}x) → เพิ่มงบ ${policy.maxBudgetChangePct}% จาก ฿${fmt(e.dailyBudget)} เป็น ฿${fmt(to)}`,
          });
        }
      } else if (losing) {
        const to = Math.max(policy.budgetFloor, Math.round(e.dailyBudget * (1 - step)));
        if (to < e.dailyBudget) {
          push(account, e, {
            kind: 'budget', from: e.dailyBudget, to, rule: 'scale_down', severity: 'warn', metrics: k,
            confidence: 0.7,
            reason: `ผลงานต่ำกว่าเป้า (${k.roas != null ? `ROAS ${fmt(k.roas)}x` : ''}${k.cpa != null ? ` CPA ฿${fmt(k.cpa)}` : ''}) → ลดงบ ${policy.maxBudgetChangePct}% เหลือ ฿${fmt(to)} เพื่อจำกัดความเสียหาย`,
          });
        }
      }
    }

    // ── Bid tuning (manual-bid ad sets) ────────────────────────────────────
    for (const e of all.filter((x) => x.bid != null && x.level === 'adset')) {
      if (e.aiExcluded || !activeWithAncestors(e, byId) || pausedThisPass.has(e.id)) continue;
      if (underCooldown(e, 'bid', policy.cooldownMin)) continue;
      const k = kpisOf(todayTotals(e, all));
      if (k.spend < policy.minSpendForDecision || k.cpa == null) continue;
      if (k.cpa > policy.targetCpa * 1.2) {
        const to = Math.max(1, Math.round(e.bid * 0.9 * 100) / 100);
        if (to < e.bid) {
          push(account, e, {
            kind: 'bid', from: e.bid, to, rule: 'bid_down', severity: 'info', metrics: k, confidence: 0.65,
            reason: `CPA ฿${fmt(k.cpa)} เกินเป้า → ลด bid 10% (฿${fmt(e.bid)} → ฿${fmt(to)}) เพื่อคุมต้นทุนต่อคลิก`,
          });
        }
      } else if (k.cpa < policy.targetCpa * 0.7 && k.conv >= 3) {
        const to = Math.round(e.bid * 1.1 * 100) / 100;
        push(account, e, {
          kind: 'bid', from: e.bid, to, rule: 'bid_up', severity: 'info', metrics: k, confidence: 0.65,
          reason: `CPA ฿${fmt(k.cpa)} ต่ำกว่าเป้ามาก → เพิ่ม bid 10% (฿${fmt(e.bid)} → ฿${fmt(to)}) เพื่อชิง traffic เพิ่ม`,
        });
      }
    }

    // ── Anomaly alerts (no platform mutation — just tell humans) ───────────
    for (const e of budgetBearing) {
      if (!activeWithAncestors(e, byId)) continue;
      const k = kpisOf(todayTotals(e, all));
      if (policy.alerts.spendSpike && k.spend > e.dailyBudget * 1.3 && !alertedToday(e.id, 'spend_spike', dayKey)) {
        push(account, e, {
          kind: 'alert', rule: 'spend_spike', severity: 'critical', metrics: k, confidence: 1,
          reason: `⚠️ ใช้งบเกินโควตา: วันนี้ใช้ไป ฿${fmt(k.spend)} เกินงบรายวัน ฿${fmt(e.dailyBudget)} กว่า 30% แล้ว`,
        });
      }
      if (policy.alerts.ctrDrop && k.imp >= policy.minImpressions) {
        const base = dailyBaseline(descendantAdIds(e, all));
        const baseK = base ? kpisOf(base) : null;
        if (baseK && baseK.imp >= policy.minImpressions && baseK.ctr > 0 &&
          k.ctr < baseK.ctr * 0.5 && !alertedToday(e.id, 'ctr_drop', dayKey)) {
          push(account, e, {
            kind: 'alert', rule: 'ctr_drop', severity: 'warn', metrics: k, confidence: 0.8,
            reason: `📉 CTR ตกฮวบ: วันนี้ ${fmt(k.ctr)}% ต่ำกว่าค่าเฉลี่ย 7 วัน (${fmt(baseK.ctr)}%) เกินครึ่ง — ครีเอทีฟอาจล้า ควรเปลี่ยนชิ้นงาน`,
          });
        }
      }
    }
    if (policy.alerts.zeroDelivery && hour >= 10) {
      const accountDelivering = kpisOf(windowTotals(all.filter((e) => e.level === 'ad').map((e) => e.id), 120)).imp > 0;
      for (const e of all.filter((x) => x.level === 'ad')) {
        if (!activeWithAncestors(e, byId)) continue;
        const k = kpisOf(todayTotals(e, all));
        if (k.imp === 0 && accountDelivering && !alertedToday(e.id, 'zero_delivery', dayKey)) {
          push(account, e, {
            kind: 'alert', rule: 'zero_delivery', severity: 'warn', metrics: k, confidence: 0.75,
            reason: '🚫 แอดเปิดอยู่แต่ไม่มี impression เลยวันนี้ — อาจไม่ผ่านรีวิว/แพ้ประมูล ตรวจสอบใน Ads Manager',
          });
        }
      }
    }
  }

  // Respect toggles, then cap mutating actions per cycle (alerts ride free).
  const enabledKind = (i) =>
    (i.kind === 'pause' || i.kind === 'resume'
      ? (i.rule.startsWith('daypart') ? policy.dayparting.enabled
        : i.rule === 'ab_loser' ? policy.autoRotate : policy.autoPause)
      : i.kind === 'budget' ? policy.autoBudget
        : i.kind === 'bid' ? policy.autoBid
          : true);
  const RULE_PRIORITY = {
    burn_no_conv: 0, cpa_kill: 1, spend_spike: 2, daypart_off: 3, daypart_on: 3,
    ab_loser: 4, scale_down: 5, scale_up: 6, bid_down: 7, bid_up: 7, ctr_drop: 8, zero_delivery: 9,
  };
  const kept = intents.filter(enabledKind).sort((a, b) => (RULE_PRIORITY[a.rule] ?? 99) - (RULE_PRIORITY[b.rule] ?? 99));
  const alerts = kept.filter((i) => i.kind === 'alert');
  const mutating = kept.filter((i) => i.kind !== 'alert').slice(0, policy.maxActionsPerCycle);
  return [...mutating, ...alerts];
}

/** People who should hear about AI ad actions: ads managers + managers. */
function adsAudience(organizationId) {
  return db.users.filter((u) => u.organizationId === organizationId && u.status !== 'disabled' &&
    (can(u, PERMISSIONS.MANAGE_ADS) || u.role === 'manager'));
}

function notifyAction(action, { suggested = false } = {}) {
  const worthTelling = suggested || action.severity === 'critical' ||
    (action.kind === 'pause' && action.rule !== 'daypart_off');
  if (!worthTelling) return;
  const title = suggested ? '🤖 AI ขออนุมัติปรับแอด'
    : action.kind === 'alert' ? '🚨 AI Ads แจ้งเตือน' : '🤖 AI ปรับแอดให้แล้ว';
  for (const u of adsAudience(action.organizationId)) {
    notify(u.id, { type: 'ads', title, body: `${action.entityName}: ${action.reason}` });
  }
}

/** Mirror a successful platform mutation into our cached entity row. */
function mirrorAction(entity, intent, { source = 'ai' } = {}) {
  const ai = { ...(entity.ai || {}), last: { ...(entity.ai?.last || {}), [intent.kind]: isoNow() } };
  const patch = { ai };
  if (intent.kind === 'pause') { patch.status = 'paused'; ai.pausedBy = source === 'ai' ? intent.rule : 'manual'; }
  if (intent.kind === 'resume') { patch.status = 'active'; ai.pausedBy = null; }
  if (intent.kind === 'budget') patch.dailyBudget = intent.to;
  if (intent.kind === 'bid') patch.bid = intent.to;
  db.adEntities.update(entity.id, patch);
}

/** Turn one intent into an audit-logged action (applied or suggested). */
export async function executeIntent(org, policy, intent, { forceApply = false, byUserId = null, source = 'ai' } = {}) {
  const account = db.adAccounts.get(intent.accountId);
  const entity = db.adEntities.get(intent.entityId);
  if (!account || !entity) return null;

  const base = {
    organizationId: org.id,
    accountId: account.id, accountName: account.name,
    entityId: entity.id, entityName: entity.name, entityLevel: entity.level,
    platform: account.platform,
    kind: intent.kind, from: intent.from ?? null, to: intent.to ?? null,
    rule: intent.rule, reason: intent.reason, severity: intent.severity || 'info',
    confidence: intent.confidence ?? null, metrics: intent.metrics || null,
    source, byUserId,
  };

  // Alerts never mutate the platform.
  if (intent.kind === 'alert') {
    const action = db.adActions.insert({ ...base, status: 'applied', appliedAt: isoNow() });
    notifyAction(action);
    bus.emit('ads:action', { organizationId: org.id, action });
    return action;
  }

  // Suggest mode → queue for approval instead of touching the platform.
  if (policy.mode === 'suggest' && !forceApply) {
    if (openSuggestionExists(entity.id, intent.rule)) return null;
    const action = db.adActions.insert({ ...base, status: 'suggested' });
    notifyAction(action, { suggested: true });
    bus.emit('ads:action', { organizationId: org.id, action });
    return action;
  }

  let action;
  try {
    await getAdsProvider(account).apply(account, entity, intent);
    mirrorAction(entity, intent, { source });
    action = db.adActions.insert({ ...base, status: 'applied', appliedAt: isoNow() });
    log.info(`${source} ${intent.kind} [${intent.rule}] ${entity.name}`);
  } catch (e) {
    action = db.adActions.insert({ ...base, status: 'failed', error: e.message });
    log.warn(`apply failed ${intent.kind} ${entity.name}: ${e.message}`);
  }
  notifyAction(action);
  bus.emit('ads:action', { organizationId: org.id, action });
  return action;
}

/** Approve / reject a queued suggestion (suggest mode). */
export async function resolveSuggestion(actionId, user, approve) {
  const action = db.adActions.get(actionId);
  if (!action || action.status !== 'suggested') throw new Error('ไม่พบรายการที่รออนุมัติ');
  if (!approve) {
    const updated = db.adActions.update(action.id, { status: 'rejected', byUserId: user.id });
    bus.emit('ads:action', { organizationId: action.organizationId, action: updated });
    return updated;
  }
  const org = db.organizations.get(action.organizationId);
  const account = db.adAccounts.get(action.accountId);
  const entity = db.adEntities.get(action.entityId);
  if (!account || !entity) throw new Error('บัญชีหรือแอดนี้ถูกลบไปแล้ว');
  try {
    await getAdsProvider(account).apply(account, entity, action);
    mirrorAction(entity, action, { source: 'ai' });
    const updated = db.adActions.update(action.id, { status: 'applied', appliedAt: isoNow(), byUserId: user.id });
    bus.emit('ads:action', { organizationId: org.id, action: updated });
    return updated;
  } catch (e) {
    const updated = db.adActions.update(action.id, { status: 'failed', error: e.message, byUserId: user.id });
    bus.emit('ads:action', { organizationId: org.id, action: updated });
    throw new Error(e.message);
  }
}

/** Manual control from the dashboard (pause / resume / budget / bid). */
export async function manualAction(user, entity, { kind, value }) {
  const account = db.adAccounts.get(entity.accountId);
  const org = db.organizations.get(entity.organizationId);
  if (!account || !org) throw new Error('account not found');
  const intent = {
    accountId: account.id, entityId: entity.id, kind,
    from: kind === 'budget' ? entity.dailyBudget : kind === 'bid' ? entity.bid : null,
    to: value ?? null,
    rule: 'manual', severity: 'info', confidence: 1,
    reason: `ปรับโดย ${user.name}`,
  };
  if (kind === 'budget' && !(Number(value) > 0)) throw new Error('ต้องระบุงบรายวันมากกว่า 0');
  if (kind === 'bid' && !(Number(value) > 0)) throw new Error('ต้องระบุ bid มากกว่า 0');
  return executeIntent(org, orgAdsPolicy(org), intent, { forceApply: true, byUserId: user.id, source: 'manual' });
}

/** One full optimization cycle for an org: sync → decide → act → broadcast. */
export async function runAdsCycle(org) {
  const policy = orgAdsPolicy(org);
  if (!policy.enabled) return { skipped: true, actions: [] };

  for (const account of db.adAccounts.filter((a) => a.organizationId === org.id && a.status === 'active')) {
    try {
      const rows = await getAdsProvider(account).sync(account);
      ingestMetrics(account, rows);
      db.adAccounts.update(account.id, { lastSyncAt: isoNow(), syncError: null });
    } catch (e) {
      db.adAccounts.update(account.id, { lastSyncAt: isoNow(), syncError: e.message });
      log.warn(`sync failed for ${account.name}: ${e.message}`);
    }
  }

  const intents = decideActions(org, policy);
  const actions = [];
  for (const intent of intents) {
    const a = await executeIntent(org, policy, intent);
    if (a) actions.push(a);
  }

  bus.emit('ads:tick', {
    organizationId: org.id,
    summary: { ...orgTodayKpis(org.id), actions: actions.length, at: isoNow() },
  });
  return { actions };
}

const lastRunByOrg = new Map();
let timer = null;

/**
 * Real-time heartbeat. Checks every 15 s which orgs are due (per their policy
 * intervalSec) and runs their optimization cycle.
 */
export function startAdsOptimizer(checkMs = 15000) {
  if (timer) return;
  const tick = async () => {
    for (const org of db.organizations.all()) {
      const policy = orgAdsPolicy(org);
      if (!policy.enabled) continue;
      const last = lastRunByOrg.get(org.id) || 0;
      if (Date.now() - last < policy.intervalSec * 1000) continue;
      lastRunByOrg.set(org.id, Date.now());
      try {
        await runAdsCycle(org);
      } catch (e) {
        log.error(`cycle failed for ${org.name}: ${e.message}`);
      }
    }
  };
  timer = setInterval(tick, checkMs);
  timer.unref?.();
  tick(); // first data within seconds of boot
}
