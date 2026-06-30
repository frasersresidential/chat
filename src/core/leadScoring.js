/**
 * Prospect / lead interest scoring engine.
 *
 * Turns a normalized lead (a customer visit / enquiry record) into an
 * explainable 0–100 "interest score" so the team can see at a glance which
 * customers are on-target and worth chasing first.
 *
 * The score is split into two transparent sub-scores:
 *   • intent — how ready-to-buy the customer is right now (grading, sales
 *     stage, revisit, decision timeframe, buying signals in the notes).
 *   • fit    — how well the customer matches the ideal buyer profile
 *     (income, budget, occupation, lead source, target area, data quality).
 *
 *   interest = round(intentWeight·intent + fitWeight·fit)
 *
 * Everything here is pure and deterministic — no network, no LLM, no clock —
 * so it runs offline and is trivially unit-testable. Free-text notes are read
 * by `analyzeNotes()` with keyword heuristics; when an LLM is available its
 * richer analysis can be passed straight into `scoreLead(lead, { analysis })`
 * to override the heuristic one (see leads.js / the README for the rationale).
 */

export const TIERS = ['hot', 'warm', 'cold'];

/** Tunable scoring configuration. Weights are "max points" per factor. */
export const DEFAULT_CONFIG = {
  // How intent vs fit combine into the headline interest score.
  intentWeight: 0.6,
  fitWeight: 0.4,
  // Tier thresholds on the final interest score.
  hotAt: 70,
  warmAt: 45,
  // Ideal-customer-profile tuning (Thai housing context from the sample data).
  budgetTargetM: 3, // a budget at/above this (฿M) is fully on-target
  targetProvinces: ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ'],
};

// ── Free-text note analysis ────────────────────────────────────────────────────
// Visit notes are rich Thai free text. We extract a handful of high-signal
// buying cues with keyword heuristics. This is intentionally the seam where an
// LLM can do better — replace/augment the result and feed it into scoreLead().

const DECISION_BUCKETS = [
  { key: 'immediate', score: 1.0, re: /(พร้อมโอน|ตัดสินใจวันนี้|ภายในเดือนนี้|ทันที|asap|< ?1 ?เดือน|ภายใน 1 เดือน)/i },
  { key: '1-3m', score: 0.85, re: /(1-3 ?เดือน|1 ?- ?3|ภายใน 3 เดือน|ไตรมาส)/i },
  { key: '4-6m', score: 0.55, re: /(4-6 ?เดือน|4 ?- ?6|ครึ่งปี|ภายใน 6 เดือน)/i },
  { key: '6-12m', score: 0.3, re: /(6-12 ?เดือน|7-12|ภายในปี|สิ้นปี)/i },
  { key: '12m+', score: 0.12, re: /(ปีหน้า|มากกว่า 1 ?ปี|> ?1 ?ปี|ยังไม่รีบ|ยังไม่เร่ง)/i },
];

/**
 * Analyze a free-text visit note and return discrete buying signals.
 * @returns {{ decisionScore:number, decisionBucket:string,
 *   interested:boolean, comparing:boolean, loanReady:boolean,
 *   loanConcern:boolean, objection:boolean }}
 */
export function analyzeNotes(text) {
  const t = String(text || '');
  let decisionBucket = 'unknown';
  let decisionScore = 0.4; // neutral when we can't tell
  for (const b of DECISION_BUCKETS) {
    if (b.re.test(t)) { decisionBucket = b.key; decisionScore = b.score; break; }
  }
  // A comparison line is only a real signal when it actually names a competitor.
  const compareLine = t.match(/(?:โครงการที่เปรียบเทียบ|เปรียบเทียบ(?:กับ)?)\s*:?\s*([^\n\r]*)/);
  const comparing = !!(compareLine && compareLine[1] && compareLine[1].replace(/[-\s]/g, '').length > 0);

  return {
    decisionScore,
    decisionBucket,
    interested: /(สนใจ|อยากได้|อยากซื้อ|ชอบบ้าน|ตัดสินใจจอง|จอง)/.test(t),
    comparing,
    loanReady: /(กู้ผ่าน|พรีอนุมัติ|พรี-อนุมัติ|อนุมัติวงเงิน|ธนาคารให้วงเงิน|วงเงินอนุมัติ|ผ่านพรี)/.test(t),
    loanConcern: /(กู้ไม่ผ่าน|ติดเครดิต|ติดแบล|ติดบูโร|เครดิตไม่ดี|ภาระหนี้สูง)/.test(t),
    objection: /(ยังไม่จอง|ขอกลับไปคิด|ยังไม่ตัดสินใจ|ขอปรึกษา|ยังไม่พร้อม|รอ)/.test(t),
  };
}

// ── Field parsers ──────────────────────────────────────────────────────────────

/** Pull a single uppercase grade letter (A–F) from values like "A : จอง". */
export function gradeLetter(grading) {
  const m = String(grading || '').toUpperCase().match(/\b([A-F])\b/);
  return m ? m[1] : null;
}

/** Budget midpoint in ฿millions from ranges like "3.01 - 3.50" → 3.255. */
export function parseBudgetM(budget) {
  const nums = String(budget || '').match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map(Number);
  const mid = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Number.isFinite(mid) ? mid : null;
}

/** Rough monthly-income score 0..1 from brackets like "มากกว่า 40,001". */
export function parseIncomeScore(salary) {
  const s = String(salary || '');
  if (!s.trim()) return null;
  const nums = (s.match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, ''))).filter(Number.isFinite);
  if (!nums.length) return 0.3;
  let max = Math.max(...nums);
  // "2-3 ล้าน" style figures are stated in millions.
  if (/ล้าน|m\b/i.test(s) && max < 100) max *= 1_000_000;
  // Normalize against a ~120k/month "fully qualified" ceiling.
  return Math.max(0, Math.min(1, max / 120_000));
}

const STAGE_SCORES = [
  { score: 1.0, re: /(closed won|won|booked|reserved|จอง|โอน|prebook|pre-?book)/i },
  { score: 0.7, re: /(negotiat|proposal|quotation|เสนอ|ต่อรอง)/i },
  { score: 0.5, re: /(qualified|คัดกรอง|มีศักยภาพ)/i },
  { score: 0.3, re: /(contacted|follow|ติดตาม|ติดต่อ)/i },
  { score: 0.15, re: /(new|open|ใหม่|lost|แพ้|ปิดการขายไม่สำเร็จ)/i },
];
function stageScore(stage) {
  for (const s of STAGE_SCORES) if (s.re.test(String(stage || ''))) return s.score;
  return 0.2;
}

const GRADE_SCORE = { A: 1.0, B: 0.72, C: 0.45, D: 0.22, E: 0.12, F: 0.05 };

// ── The scorer ──────────────────────────────────────────────────────────────────

const clamp = (n) => Math.max(0, Math.min(100, n));
const factor = (label, points, max, detail) =>
  ({ label, points: Math.round(points), max, detail });

/**
 * Score one normalized lead.
 *
 * @param {object} lead   normalized lead (see leads.js `normalizeCoSaleRow`)
 * @param {object} [opts]
 * @param {object} [opts.config]    override DEFAULT_CONFIG
 * @param {object} [opts.analysis]  pre-computed note analysis (e.g. from an LLM)
 * @returns {{ score:number, tier:string, intent:number, fit:number,
 *   converted:boolean, analysis:object, factors:Array }}
 */
export function scoreLead(lead = {}, opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const analysis = opts.analysis || analyzeNotes(lead.notes);

  // ── Intent (max 100) ──────────────────────────────────────────────────────
  const g = gradeLetter(lead.grading);
  const gScore = g ? GRADE_SCORE[g] : 0.25;
  const sScore = stageScore(lead.stage);

  const intentFactors = [
    factor('เกรดจากเซลส์ (Grading)', gScore * 35, 35, g ? `เกรด ${g}` : 'ไม่ได้ให้เกรด'),
    factor('สถานะการขาย (Stage)', sScore * 25, 25, lead.stage || '—'),
    factor('กลับมาดูซ้ำ (Revisit)', lead.revisit ? 12 : 0, 12, lead.revisit ? 'เคยกลับมาดูซ้ำ' : 'เข้าชมครั้งแรก'),
    factor('ระยะเวลาตัดสินใจ', analysis.decisionScore * 15, 15, decisionLabel(analysis.decisionBucket)),
    factor('สัญญาณในโน้ต', notesIntentPoints(analysis), 13, notesIntentDetail(analysis)),
  ];
  const intent = clamp(intentFactors.reduce((a, f) => a + f.points, 0));

  // ── Fit / ICP (max 100) ───────────────────────────────────────────────────
  const incScore = parseIncomeScore(lead.salary);
  const budgetM = parseBudgetM(lead.budget);
  const budgetScore = budgetM == null ? null : Math.max(0, Math.min(1, budgetM / cfg.budgetTargetM));
  const provinceHit = !!lead.province && cfg.targetProvinces.includes(String(lead.province).trim());
  const completeness = leadCompleteness(lead);

  const fitFactors = [
    factor('รายได้ (Salary)', (incScore == null ? 0.3 : incScore) * 35, 35,
      incScore == null ? 'ไม่ระบุรายได้' : (lead.salary || '—')),
    factor('งบประมาณ (Budget)', (budgetScore == null ? 0.3 : budgetScore) * 30, 30,
      budgetM == null ? 'ไม่ระบุงบ' : `~${budgetM.toFixed(2)} ลบ.`),
    factor('อาชีพ (Occupation)', occupationScore(lead.occupation) * 12, 12, lead.occupation || '—'),
    factor('ช่องทางที่มา (Lead Source)', leadSourceScore(lead.leadSource) * 8, 8, lead.leadSource || '—'),
    factor('พื้นที่เป้าหมาย', provinceHit ? 8 : (lead.province ? 3 : 0), 8, lead.province || '—'),
    factor('ความครบของข้อมูล', completeness * 7, 7, `${Math.round(completeness * 100)}%`),
  ];
  const fit = clamp(fitFactors.reduce((a, f) => a + f.points, 0));

  let score = clamp(Math.round(cfg.intentWeight * intent + cfg.fitWeight * fit));
  // A live loan-approval problem is a hard cap — don't flag as hot.
  if (analysis.loanConcern) score = Math.min(score, cfg.warmAt + 9);

  const tier = score >= cfg.hotAt ? 'hot' : score >= cfg.warmAt ? 'warm' : 'cold';
  const converted = /(closed won|won|booked)/i.test(String(lead.stage || '')) || /จอง/.test(String(lead.visitRemark || lead.grading || ''));

  return {
    score, tier, intent, fit, converted, analysis,
    factors: [
      ...intentFactors.map((f) => ({ ...f, group: 'intent' })),
      ...fitFactors.map((f) => ({ ...f, group: 'fit' })),
    ],
  };
}

// ── Sub-scorers / labels ────────────────────────────────────────────────────────

function notesIntentPoints(a) {
  let p = 0;
  if (a.interested) p += 5;
  if (a.comparing) p += 4; // actively comparison-shopping = a real buyer
  if (a.loanReady) p += 4;
  if (a.objection) p -= 3;
  if (a.loanConcern) p -= 4;
  return Math.max(0, Math.min(13, p));
}
function notesIntentDetail(a) {
  const on = [];
  if (a.interested) on.push('แสดงความสนใจ');
  if (a.comparing) on.push('เทียบโครงการอื่น');
  if (a.loanReady) on.push('สินเชื่อพร้อม');
  if (a.loanConcern) on.push('⚠ ติดเรื่องกู้');
  if (a.objection) on.push('ยังลังเล');
  return on.length ? on.join(', ') : 'ไม่พบสัญญาณชัดเจน';
}
function decisionLabel(bucket) {
  return ({
    immediate: 'พร้อมตัดสินใจทันที', '1-3m': '1–3 เดือน', '4-6m': '4–6 เดือน',
    '6-12m': '6–12 เดือน', '12m+': 'มากกว่า 1 ปี', unknown: 'ไม่ระบุ',
  })[bucket] || 'ไม่ระบุ';
}
function occupationScore(occ) {
  const s = String(occ || '');
  if (!s.trim()) return 0.3;
  if (/(ธุรกิจส่วนตัว|เจ้าของ|กิจการ|ค้าขาย|ผู้บริหาร|แพทย์|วิศวกร)/.test(s)) return 1.0;
  if (/(พนักงาน|ข้าราชการ|รัฐวิสาหกิจ|บริษัท)/.test(s)) return 0.8;
  return 0.5;
}
function leadSourceScore(src) {
  const s = String(src || '');
  if (!s.trim()) return 0.4;
  if (/(walk|เดินเข้า|referral|แนะนำ|call center|โอนสาย)/i.test(s)) return 1.0;
  if (/(facebook|lead|line|tiktok|google|เว็บ|online)/i.test(s)) return 0.7;
  return 0.5;
}
function leadCompleteness(lead) {
  const fields = ['mobile', 'budget', 'salary', 'occupation', 'province', 'notes', 'grading'];
  const have = fields.filter((f) => String(lead[f] || '').trim()).length;
  return have / fields.length;
}
