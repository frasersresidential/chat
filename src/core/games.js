import { customAlphabet } from 'nanoid';
import { db } from '../store/db.js';
import { logger } from '../logger.js';

const log = logger('games');

/**
 * Gamification lucky-draw engine.
 *
 * One campaign = one prize pool + odds + daily play limit, rendered through
 * any of several game "skins" (wheel / sticks / cards). The prize is always
 * drawn server-side with weighted random so odds cannot be tampered with from
 * the browser — the client only animates toward the result it receives.
 *
 * Campaign shape (collection `gameCampaigns`):
 *   { id, organizationId, name, active,
 *     games: ['wheel'|'sticks'|'cards', ...],
 *     limitPerDay,
 *     prizes: [{ id, label, win, weight, stock|null, color, couponPrefix }] }
 *
 * Draw record (collection `gameDraws`):
 *   { id, campaignId, playerId, game, prizeId, win, couponCode, fortune, day }
 */

export const GAME_TYPES = ['wheel', 'sticks', 'cards'];

// ── Theming ────────────────────────────────────────────────────────────────
// The game page is fully token-driven: a campaign carries a theme (preset +
// color/style overrides) and the client maps it onto CSS variables. Admins
// pick a preset in the Games tab, then fine-tune any color with a picker.
export const THEME_PRESETS = {
  frasers: {
    label: 'Frasers Property',
    colors: { bg: '#f7f5f2', surface: '#ffffff', ink: '#333f48', muted: '#828a92', accent: '#da291c', accent2: '#333f48', highlight: '#c9a557' },
    style: { radius: 8, borderWidth: 1, shadow: 'soft', pattern: 'none' },
  },
  studio: {
    label: 'Studio',
    colors: { bg: '#f4f2ec', surface: '#ffffff', ink: '#23212b', muted: '#7a7581', accent: '#4f46e5', accent2: '#23212b', highlight: '#f2b634' },
    style: { radius: 14, borderWidth: 1.5, shadow: 'soft', pattern: 'none' },
  },
  pop: {
    label: 'Candy Pop',
    colors: { bg: '#efe9ff', surface: '#ffffff', ink: '#1a1428', muted: '#6f6787', accent: '#ff4d8d', accent2: '#7c5cff', highlight: '#ffd43a' },
    style: { radius: 18, borderWidth: 2, shadow: 'hard', pattern: 'dots' },
  },
  luxe: {
    label: 'Midnight Luxe',
    colors: { bg: '#0c0c11', surface: '#16161e', ink: '#ece7db', muted: '#8e897c', accent: '#d4b26a', accent2: '#2e2a3c', highlight: '#ecd9a8' },
    style: { radius: 6, borderWidth: 1, shadow: 'none', pattern: 'none' },
  },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHADOWS = ['soft', 'hard', 'none'];
const PATTERNS = ['none', 'dots'];

/** Merge a theme payload onto a preset base, keeping only valid values. */
export function sanitizeTheme(body = {}, existing = {}) {
  const preset = THEME_PRESETS[body.preset] ? body.preset : (THEME_PRESETS[existing.preset] ? existing.preset : 'studio');
  const base = THEME_PRESETS[preset];
  const prevColors = existing.colors || {};
  const prevStyle = existing.style || {};
  const colors = {};
  for (const key of Object.keys(base.colors)) {
    const v = body.colors?.[key] ?? prevColors[key];
    colors[key] = HEX_RE.test(v || '') ? v.toLowerCase() : base.colors[key];
  }
  const s = body.style || {};
  const num = (v, prev, fallback, min, max) => {
    const n = Number(v ?? prev);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    preset,
    colors,
    style: {
      radius: num(s.radius, prevStyle.radius, base.style.radius, 0, 32),
      borderWidth: num(s.borderWidth, prevStyle.borderWidth, base.style.borderWidth, 0, 4),
      shadow: SHADOWS.includes(s.shadow ?? prevStyle.shadow) ? (s.shadow ?? prevStyle.shadow) : base.style.shadow,
      pattern: PATTERNS.includes(s.pattern ?? prevStyle.pattern) ? (s.pattern ?? prevStyle.pattern) : base.style.pattern,
    },
  };
}

const couponSuffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// ── Fortune flavour content ─────────────────────────────────────────────────
// เซียมซี: the slip's fortune text is independent of the prize — even a losing
// draw still hands the player a shareable คำทำนาย.
export const SIAMSI_FORTUNES = [
  { number: 1, tone: 'ดีมาก', text: 'ดวงเปิดรับโชคใหญ่ สิ่งที่รอคอยจะสมหวังเกินคาด การงานมีผู้ใหญ่สนับสนุน การเงินไหลลื่นดั่งสายน้ำ' },
  { number: 2, tone: 'ดี', text: 'เหมือนเรือได้ลมส่ง ค่อย ๆ แล่นสู่ฝั่งฝัน ความรักราบรื่น คนโสดจะพบคนถูกใจในเร็ววัน' },
  { number: 3, tone: 'กลาง', text: 'ฟ้าหลังฝนย่อมสดใส อดทนอีกนิดแล้วทุกอย่างจะคลี่คลาย ระวังใช้จ่ายเกินตัวช่วงกลางเดือน' },
  { number: 4, tone: 'ดี', text: 'มีเกณฑ์ได้ลาภจากผู้ใหญ่หรือคนแดนไกล งานที่ติดขัดจะมีคนยื่นมือช่วย จังหวะนี้เหมาะเริ่มสิ่งใหม่' },
  { number: 5, tone: 'ดีมาก', text: 'ดาวรุ่งพุ่งแรง คิดสิ่งใดสมปรารถนา การเจรจาค้าขายสำเร็จงดงาม มีข่าวดีเข้ามาไม่ขาดสาย' },
  { number: 6, tone: 'กลาง', text: 'เส้นทางยังมีหมอกบัง อย่าเพิ่งรีบตัดสินใจเรื่องใหญ่ ตั้งสติแล้วโอกาสดีจะปรากฏเอง' },
  { number: 7, tone: 'ดี', text: 'บุญเก่าหนุนนำ คนเคยช่วยเหลือจะกลับมาตอบแทน สุขภาพแข็งแรง ครอบครัวอบอุ่นเป็นกำลังใจ' },
  { number: 8, tone: 'ดีมาก', text: 'เลขแห่งความมั่งคั่ง ทรัพย์สินเพิ่มพูน งานเด่นเงินดี ความรักหวานชื่นเหมือนข้าวใหม่ปลามัน' },
  { number: 9, tone: 'ดี', text: 'ก้าวหน้ารุ่งเรืองดั่งเลขเก้า มีเกณฑ์เลื่อนขั้นเลื่อนตำแหน่ง สิ่งศักดิ์สิทธิ์คุ้มครองให้แคล้วคลาด' },
  { number: 10, tone: 'กลาง', text: 'น้ำขึ้นให้รีบตัก โอกาสมาแบบไม่ทันตั้งตัว เตรียมตัวให้พร้อมแล้วคว้าไว้ อย่าลังเลจนสายเกินไป' },
  { number: 11, tone: 'ดี', text: 'มีมิตรดีคอยเกื้อหนุน งานกลุ่มงานทีมจะพาไปไกล การเงินมีเข้ามาหลายทาง เก็บออมไว้จะงอกเงย' },
  { number: 12, tone: 'ดีมาก', text: 'สุดยอดแห่งโชคลาภ ดวงชะตาสว่างไสวดั่งจันทร์เพ็ญ ปรารถนาสิ่งใดจะได้ดั่งใจหมาย ควรหมั่นทำบุญเสริมดวง' },
];

// เปิดไพ่: tarot-inspired deck, kept upbeat — this is marketing, not divination.
export const TAROT_CARDS = [
  { key: 'sun', name: 'The Sun', emoji: '🌞', meaning: 'พลังบวกเจิดจ้า ความสำเร็จและชื่อเสียงกำลังส่องแสงมาที่คุณ สิ่งที่ทำอยู่จะออกดอกออกผล' },
  { key: 'star', name: 'The Star', emoji: '⭐', meaning: 'ความหวังกลับมาเปล่งประกาย คำอธิษฐานใกล้เป็นจริง อย่าหยุดเชื่อในตัวเอง' },
  { key: 'moon', name: 'The Moon', emoji: '🌙', meaning: 'สัญชาตญาณกำลังบอกอะไรบางอย่าง ฟังเสียงข้างในแล้วคุณจะพบคำตอบที่ตามหา' },
  { key: 'wheel', name: 'Wheel of Fortune', emoji: '🎡', meaning: 'วงล้อแห่งโชคชะตาหมุนมาทางคุณ การเปลี่ยนแปลงครั้งนี้จะพาไปเจอสิ่งที่ดีกว่า' },
  { key: 'lovers', name: 'The Lovers', emoji: '💞', meaning: 'ความสัมพันธ์กำลังเบ่งบาน ทั้งรักและมิตรภาพ ใครมีคู่จะหวานขึ้น คนโสดเตรียมใจเต้น' },
  { key: 'strength', name: 'Strength', emoji: '🦁', meaning: 'พลังใจของคุณแข็งแกร่งกว่าที่คิด อุปสรรคตรงหน้าเล็กนิดเดียว ลุยได้เลย' },
  { key: 'world', name: 'The World', emoji: '🌍', meaning: 'ครบถ้วนสมบูรณ์ เรื่องที่ค้างคาจะจบลงอย่างงดงาม และบทใหม่ที่ดีกว่ากำลังเริ่มต้น' },
  { key: 'fool', name: 'The Fool', emoji: '🎒', meaning: 'จงกล้าเริ่มต้นใหม่แบบไม่กลัวพลาด การเดินทางครั้งนี้จะให้ประสบการณ์ล้ำค่า' },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Bangkok-local calendar day, used as the daily play-limit bucket. */
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

/** Client-safe campaign view — never leak weights, stock counts or the gate code. */
export function publicCampaign(campaign) {
  const gate = campaign.gate || {};
  return {
    id: campaign.id,
    name: campaign.name,
    active: campaign.active !== false,
    games: campaign.games || GAME_TYPES,
    limitPerDay: campaign.limitPerDay ?? 3,
    theme: sanitizeTheme(campaign.theme || {}, campaign.theme || {}),
    // gate.code is deliberately omitted — the entry form validates it server-side.
    gate: { enabled: !!gate.enabled, projects: gate.projects || [] },
    prizes: (campaign.prizes || []).map((p) => ({
      id: p.id, label: p.label, win: p.win !== false, color: p.color || null,
      soldOut: p.stock === 0,
    })),
  };
}

/** Has this player already passed the entry gate for this campaign? */
export function hasEntered(campaignId, playerId) {
  return !!db.gameEntries.find((e) => e.campaignId === campaignId && e.playerId === playerId);
}

/**
 * Validate the entry form and, if the access code matches, record the player's
 * details. Returns { error } on a bad code / missing field, else { ok }.
 */
export function enterGate({ campaign, playerId, name, project, plot, code }) {
  if (!campaign || campaign.active === false) return { error: 'campaign_inactive' };
  if (!playerId || typeof playerId !== 'string' || playerId.length > 80) return { error: 'bad_player' };
  const gate = campaign.gate || {};
  const nm = String(name || '').trim();
  if (!nm) return { error: 'missing_name' };
  if (gate.enabled) {
    const want = String(gate.code || '').trim().toLowerCase();
    const got = String(code || '').trim().toLowerCase();
    if (!want) return { error: 'no_code_configured' };
    if (got !== want) return { error: 'bad_code' };
  }
  const existing = db.gameEntries.find((e) => e.campaignId === campaign.id && e.playerId === playerId);
  const data = {
    campaignId: campaign.id, playerId,
    name: nm.slice(0, 120),
    project: String(project || '').trim().slice(0, 120),
    plot: String(plot || '').trim().slice(0, 60),
  };
  if (existing) db.gameEntries.update(existing.id, data);
  else db.gameEntries.insert(data);
  return { ok: true };
}

export function drawsToday(campaignId, playerId) {
  const day = todayKey();
  return db.gameDraws.filter((d) => d.campaignId === campaignId && d.playerId === playerId && d.day === day);
}

export function remainingToday(campaign, playerId) {
  const limit = campaign.limitPerDay ?? 3;
  return Math.max(0, limit - drawsToday(campaign.id, playerId).length);
}

/** Weighted random over prizes that still have stock. */
function weightedPick(prizes) {
  const pool = prizes.filter((p) => p.stock === null || p.stock === undefined || p.stock > 0);
  if (!pool.length) return null;
  const total = pool.reduce((s, p) => s + (p.weight || 1), 0);
  let r = Math.random() * total;
  for (const p of pool) {
    r -= (p.weight || 1);
    if (r <= 0) return p;
  }
  return pool[pool.length - 1];
}

/**
 * Perform one draw. Returns { error } on rule violations, otherwise the full
 * result (prize + coupon + fortune flavour for the chosen game skin).
 */
export function draw({ campaign, playerId, game }) {
  if (!campaign || campaign.active === false) return { error: 'campaign_inactive' };
  const games = campaign.games || GAME_TYPES;
  if (!games.includes(game)) return { error: 'unknown_game' };
  if (!playerId || typeof playerId !== 'string' || playerId.length > 80) return { error: 'bad_player' };

  // Enforce the entry gate server-side so the form can't be skipped.
  if (campaign.gate?.enabled && !hasEntered(campaign.id, playerId)) return { error: 'gate_required' };

  const limit = campaign.limitPerDay ?? 3;
  if (drawsToday(campaign.id, playerId).length >= limit) return { error: 'daily_limit' };

  const prize = weightedPick(campaign.prizes || []);
  if (!prize) return { error: 'no_prizes' };

  // Decrement finite stock on the campaign document itself.
  if (typeof prize.stock === 'number') {
    const prizes = campaign.prizes.map((p) => (p.id === prize.id ? { ...p, stock: p.stock - 1 } : p));
    db.gameCampaigns.update(campaign.id, { prizes });
  }

  const win = prize.win !== false;
  const couponCode = win ? `${prize.couponPrefix || 'LUCKY'}-${couponSuffix()}` : null;
  const fortune =
    game === 'sticks' ? { type: 'siamsi', ...pick(SIAMSI_FORTUNES) } :
    game === 'cards' ? { type: 'tarot', ...pick(TAROT_CARDS) } : null;

  db.gameDraws.insert({
    campaignId: campaign.id, playerId, game,
    prizeId: prize.id, win, couponCode, fortune, day: todayKey(),
  });
  log.info(`draw: ${playerId} played ${game} on ${campaign.id} → ${prize.label}`);

  return {
    prize: { id: prize.id, label: prize.label, win },
    prizeIndex: (campaign.prizes || []).findIndex((p) => p.id === prize.id),
    couponCode,
    fortune,
    remainingToday: remainingToday(db.gameCampaigns.get(campaign.id), playerId),
  };
}

/** Aggregate stats for the admin API. */
export function campaignStats(campaignId) {
  const all = db.gameDraws.filter((d) => d.campaignId === campaignId);
  const byPrize = {};
  for (const d of all) byPrize[d.prizeId] = (byPrize[d.prizeId] || 0) + 1;
  return {
    totalDraws: all.length,
    wins: all.filter((d) => d.win).length,
    uniquePlayers: new Set(all.map((d) => d.playerId)).size,
    entries: db.gameEntries.filter((e) => e.campaignId === campaignId).length,
    byPrize,
  };
}

/** Normalize a campaign payload from the admin API. */
export function sanitizeCampaign(body, organizationId, existing = {}) {
  const prizes = Array.isArray(body.prizes) ? body.prizes.map((p, i) => ({
    id: p.id || `pz_${i + 1}`,
    label: String(p.label || `รางวัล ${i + 1}`).slice(0, 120),
    win: p.win !== false,
    weight: Math.max(0, Number(p.weight) || 1),
    stock: p.stock === null || p.stock === undefined || p.stock === '' ? null : Math.max(0, Math.floor(Number(p.stock) || 0)),
    color: typeof p.color === 'string' ? p.color.slice(0, 20) : null,
    couponPrefix: typeof p.couponPrefix === 'string' ? p.couponPrefix.slice(0, 20) : null,
  })) : existing.prizes || [];
  const games = Array.isArray(body.games) ? body.games.filter((g) => GAME_TYPES.includes(g)) : existing.games || GAME_TYPES;
  return {
    organizationId,
    name: String(body.name || existing.name || 'Lucky Draw').slice(0, 120),
    active: body.active === undefined ? existing.active !== false : !!body.active,
    games: games.length ? games : GAME_TYPES,
    limitPerDay: Math.max(1, Math.floor(Number(body.limitPerDay) || existing.limitPerDay || 3)),
    theme: sanitizeTheme(body.theme || {}, existing.theme || {}),
    gate: sanitizeGate(body.gate, existing.gate),
    prizes,
  };
}

/** Normalize the entry-gate config (form + access code + project picklist). */
export function sanitizeGate(body, existing = {}) {
  const src = body || {};
  const projects = Array.isArray(src.projects)
    ? src.projects.map((s) => String(s).trim()).filter(Boolean).slice(0, 300)
    : (existing.projects || []);
  return {
    enabled: body ? !!src.enabled : (existing.enabled ?? false),
    code: String((src.code ?? existing.code) || '').trim().slice(0, 40),
    projects,
  };
}
