import Anthropic from '@anthropic-ai/sdk';
import { db } from '../store/db.js';
import { config } from '../config.js';
import { kpisOf, todayTotals, orgTodayKpis } from './engine.js';
import { executeIntent, orgAdsPolicy } from './optimizer.js';
import { logger } from '../logger.js';

const log = logger('ads-claude');

/**
 * Strategic AI advisor. The optimizer (optimizer.js) is the fast real-time
 * control loop; this layer is the slow "strategist": it hands Claude a compact
 * snapshot of the whole ad portfolio and gets back a Thai-language analysis
 * plus concrete proposals, which land in the same approval queue as any other
 * AI suggestion.
 *
 * Needs ANTHROPIC_API_KEY. Without it we fall back to a rule-based heuristic
 * analysis so the button always does something useful.
 */

export const claudeEnabled = () => !!config.ads.anthropicApiKey;

const SYSTEM = `คุณคือ senior performance-marketing analyst ของบริษัทอสังหาริมทรัพย์ไทย
ดูแลงบโฆษณา Meta Ads และ Google Ads แบบ lead generation (ทักแชต/ลงทะเบียน)

คุณจะได้รับ snapshot ของพอร์ตโฆษณาเป็น JSON: เป้าหมาย (targetCpa/targetRoas),
ผลวันนี้ของทุก campaign/ad set/ad, และ action ล่าสุดที่ระบบ optimizer ทำไป

วิเคราะห์อย่างตรงไปตรงมาเป็นภาษาไทย แล้วตอบเป็น JSON เท่านั้น (ไม่มีข้อความอื่นนอก JSON):
{
  "summary": "ภาพรวม 2-4 ประโยค พูดถึงตัวเลขจริง",
  "insights": [{ "title": "หัวข้อสั้น", "detail": "รายละเอียด + ตัวเลขอ้างอิง", "severity": "info|warn|critical" }],
  "actions": [{ "entityId": "id จาก snapshot เท่านั้น", "kind": "pause|resume|budget|bid", "to": ตัวเลข (เฉพาะ budget/bid), "reason": "เหตุผลภาษาไทยสั้นๆ" }]
}

กติกา: เสนอ action เฉพาะที่มีข้อมูลรองรับชัดเจน (ไม่เกิน 5 รายการ), งบใหม่ต้องสมเหตุสมผล
(ไม่เกิน ±30% ของงบเดิม), ห้ามอ้าง entityId ที่ไม่มีใน snapshot, insights ไม่เกิน 6 ข้อ`;

/** Compact portfolio snapshot the model can reason over. */
function buildSnapshot(org) {
  const policy = orgAdsPolicy(org);
  const accounts = db.adAccounts.filter((a) => a.organizationId === org.id);
  const entities = [];
  for (const account of accounts) {
    const all = db.adEntities.filter((e) => e.accountId === account.id);
    for (const e of all.slice(0, 120)) {
      const k = kpisOf(todayTotals(e, all));
      entities.push({
        entityId: e.id, level: e.level, platform: account.platform, name: e.name,
        status: e.status, dailyBudget: e.dailyBudget, bid: e.bid,
        aiPausedBy: e.ai?.pausedBy || null,
        today: { imp: k.imp, clk: k.clk, spend: k.spend, conv: k.conv, rev: k.rev, ctr: k.ctr, cpa: k.cpa, roas: k.roas },
      });
    }
  }
  const recentActions = db.adActions
    .filter((a) => a.organizationId === org.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15)
    .map((a) => ({ entity: a.entityName, kind: a.kind, rule: a.rule, status: a.status, reason: a.reason }));
  return {
    targets: { targetCpa: policy.targetCpa, targetRoas: policy.targetRoas, mode: policy.mode },
    accounts: accounts.map((a) => ({ name: a.name, platform: a.platform, simulated: !Object.values(a.credential || {}).some(Boolean), syncError: a.syncError || null })),
    todayTotals: orgTodayKpis(org.id),
    entities,
    recentOptimizerActions: recentActions,
  };
}

/** Pull the JSON object out of a model reply (tolerates code fences/prose). */
function parseModelJson(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Validate the model's proposals and queue them as approval-gated actions. */
async function queueProposals(org, proposals) {
  if (!Array.isArray(proposals)) return [];
  const policy = { ...orgAdsPolicy(org), mode: 'suggest' }; // advisor never auto-applies
  const queued = [];
  for (const p of proposals.slice(0, 5)) {
    const entity = db.adEntities.get(p.entityId);
    if (!entity || entity.organizationId !== org.id) continue;
    if (!['pause', 'resume', 'budget', 'bid'].includes(p.kind)) continue;
    const to = p.kind === 'budget' || p.kind === 'bid' ? Number(p.to) : null;
    if ((p.kind === 'budget' || p.kind === 'bid') && !(to > 0)) continue;
    // Sanity-cap budget moves at ±30% even if the model proposed wilder.
    let capped = to;
    if (p.kind === 'budget' && entity.dailyBudget > 0) {
      capped = Math.min(entity.dailyBudget * 1.3, Math.max(entity.dailyBudget * 0.7, to));
      capped = Math.round(capped);
    }
    const action = await executeIntent(org, policy, {
      accountId: entity.accountId, entityId: entity.id, kind: p.kind,
      from: p.kind === 'budget' ? entity.dailyBudget : p.kind === 'bid' ? entity.bid : null,
      to: capped,
      rule: 'claude_advisor', severity: 'info', confidence: 0.7,
      reason: `🧠 Claude แนะนำ: ${String(p.reason || '').slice(0, 300)}`,
    });
    if (action) queued.push(action);
  }
  return queued;
}

/** Rule-based fallback so the analyze button works with no API key. */
function heuristicAnalysis(org) {
  const snapshot = buildSnapshot(org);
  const t = snapshot.todayTotals;
  const policy = orgAdsPolicy(org);
  const scored = snapshot.entities
    .filter((e) => e.level !== 'campaign' && e.today.spend >= policy.minSpendForDecision / 2);
  const withRoas = scored.filter((e) => e.today.roas != null);
  const best = [...withRoas].sort((a, b) => b.today.roas - a.today.roas)[0];
  const worst = [...withRoas].sort((a, b) => a.today.roas - b.today.roas)[0];
  const insights = [];
  if (best) {
    insights.push({
      severity: 'info', title: `ตัวท็อปวันนี้: ${best.name}`,
      detail: `ROAS ${best.today.roas}x · CPA ฿${best.today.cpa ?? '—'} · ใช้ไป ฿${best.today.spend} — เข้าเกณฑ์เพิ่มงบถ้ายังวิ่งต่อเนื่อง`,
    });
  }
  if (worst && worst !== best && worst.today.roas < policy.targetRoas) {
    insights.push({
      severity: 'warn', title: `ตัวรั้งท้าย: ${worst.name}`,
      detail: `ROAS ${worst.today.roas}x ต่ำกว่าเป้า ${policy.targetRoas}x · ใช้ไป ฿${worst.today.spend} — ระบบ optimizer จะลดงบ/หยุดให้เองตามกติกา`,
    });
  }
  const noConv = scored.filter((e) => e.today.conv === 0 && e.today.spend > policy.targetCpa);
  if (noConv.length) {
    insights.push({
      severity: 'critical', title: `${noConv.length} รายการเผางบโดยไม่มี lead`,
      detail: noConv.slice(0, 3).map((e) => `${e.name} (฿${e.today.spend})`).join(', ') + ' — ควรหยุดหรือเปลี่ยนครีเอทีฟ',
    });
  }
  return {
    source: 'heuristic',
    summary: `วันนี้ใช้งบรวม ฿${t.spend?.toLocaleString?.('th-TH') ?? t.spend} ได้ ${t.conv} lead` +
      (t.cpa != null ? ` (CPA ฿${t.cpa} เทียบเป้า ฿${policy.targetCpa})` : '') +
      (t.roas != null ? ` · ROAS ${t.roas}x เทียบเป้า ${policy.targetRoas}x` : '') +
      ' — ใส่ ANTHROPIC_API_KEY เพื่อปลดล็อกบทวิเคราะห์เชิงลึกจาก Claude',
    insights,
    proposedActions: [],
  };
}

/** Run the Claude analysis (or heuristic fallback). */
export async function analyzePortfolio(org) {
  if (!claudeEnabled()) return heuristicAnalysis(org);

  const snapshot = buildSnapshot(org);
  try {
    const client = new Anthropic({ apiKey: config.ads.anthropicApiKey });
    const response = await client.messages.create({
      model: config.ads.anthropicModel,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `snapshot ณ ${new Date().toISOString()}:\n${JSON.stringify(snapshot)}`,
      }],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    const parsed = parseModelJson(text);
    if (!parsed) return { source: 'claude', summary: text.slice(0, 4000), insights: [], proposedActions: [] };
    const proposedActions = await queueProposals(org, parsed.actions);
    log.info(`Claude analysis done: ${parsed.insights?.length || 0} insights, ${proposedActions.length} proposals queued`);
    return {
      source: 'claude',
      model: response.model,
      summary: String(parsed.summary || '').slice(0, 4000),
      insights: (Array.isArray(parsed.insights) ? parsed.insights : []).slice(0, 6).map((i) => ({
        title: String(i.title || '').slice(0, 200),
        detail: String(i.detail || '').slice(0, 1000),
        severity: ['info', 'warn', 'critical'].includes(i.severity) ? i.severity : 'info',
      })),
      proposedActions,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) log.warn('Claude auth failed — check ANTHROPIC_API_KEY');
    else if (e instanceof Anthropic.RateLimitError) log.warn('Claude rate limited');
    else if (e instanceof Anthropic.APIError) log.warn(`Claude API error ${e.status}: ${e.message}`);
    else log.warn(`Claude analysis failed: ${e.message}`);
    const fallback = heuristicAnalysis(org);
    fallback.error = `เรียก Claude ไม่สำเร็จ (${e.message}) — แสดงบทวิเคราะห์พื้นฐานแทน`;
    return fallback;
  }
}
