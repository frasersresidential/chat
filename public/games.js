/* ── Lucky-draw games: วงล้อ / เซียมซี / เปิดไพ่ ──────────────────────────────
 * The server decides every prize (weighted random + daily limit); this file
 * only animates toward the result it receives from POST /api/play/:id/draw. */

const qs = new URLSearchParams(location.search);
const campaignId = qs.get('c') || 'game_lucky_draw';

// Stable player identity: broadcast links can pass ?u=<customerId>; anonymous
// visitors get a random id remembered in localStorage.
const playerId = (() => {
  const fromLink = qs.get('u');
  if (fromLink) { localStorage.setItem('lucky_player_id', fromLink); return fromLink; }
  let id = localStorage.getItem('lucky_player_id');
  if (!id) {
    id = 'guest_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('lucky_player_id', id);
  }
  return id;
})();

const $ = (id) => document.getElementById(id);
const state = { campaign: null, playsLeft: 0, busy: false, rot: 0 };

const ERRORS = {
  daily_limit: 'สิทธิ์วันนี้หมดแล้ว 😴 พรุ่งนี้มาลุ้นใหม่นะ',
  campaign_inactive: 'แคมเปญนี้จบไปแล้ว ขอบคุณที่มาร่วมสนุกกัน 🙏',
  no_prizes: 'รางวัลหมดเกลี้ยงแล้ว ไวกว่านี้มีอีกนะ 😅',
  unknown_game: 'เกมนี้ไม่เปิดให้เล่นในแคมเปญนี้',
};

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

async function requestDraw(game) {
  const res = await fetch(`/api/play/${campaignId}/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, game }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(ERRORS[data.error] || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะคะ');
  return data;
}

function setPlaysLeft(n) {
  state.playsLeft = n;
  $('playsLeft').textContent = n;
}

/* ── Theme ────────────────────────────────────────────────────────────────── */
// The campaign's theme (set in the admin Games tab) is mapped onto the CSS
// variables that games.css is built from.
const contrastOn = (hex) => (brightness(hex) > 130 ? '#23212b' : '#ffffff');

function applyTheme(t) {
  if (!t) return;
  const root = document.documentElement.style;
  const c = t.colors || {};
  const map = { bg: '--bg', surface: '--surface', ink: '--ink', muted: '--muted', accent: '--accent', accent2: '--accent2', highlight: '--highlight' };
  for (const [key, cssVar] of Object.entries(map)) {
    if (c[key]) root.setProperty(cssVar, c[key]);
  }
  if (c.accent) root.setProperty('--on-accent', contrastOn(c.accent));
  if (c.accent2) root.setProperty('--on-accent2', contrastOn(c.accent2));
  if (c.highlight) root.setProperty('--on-highlight', contrastOn(c.highlight));
  if (c.ink) root.setProperty('--on-ink', contrastOn(c.ink));
  const s = t.style || {};
  if (s.radius !== undefined) root.setProperty('--radius', s.radius + 'px');
  if (s.borderWidth !== undefined) root.setProperty('--bw', s.borderWidth + 'px');
  document.body.dataset.shadow = s.shadow || 'soft';
  document.body.dataset.pattern = s.pattern || 'none';
}

/* ── เกม 1: วงล้อ ──────────────────────────────────────────────────────────── */
const FALLBACK_COLORS = ['#f2b634', '#4f46e5', '#2f9e8f', '#7fa653', '#d95d77', '#2c2a35'];

/** Perceived brightness 0-255 from a #rrggbb hex. */
function brightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
}

function buildWheel() {
  const prizes = state.campaign.prizes;
  const themeColors = state.campaign.theme?.colors || {};
  const ink = themeColors.ink || '#23212b';
  const surface = themeColors.surface || '#ffffff';
  const n = prizes.length;
  const seg = 360 / n;
  const R = 150, r = 140;
  const pt = (deg, rad) => {
    const a = (deg * Math.PI) / 180;
    return [R + rad * Math.sin(a), R - rad * Math.cos(a)];
  };
  const parts = prizes.map((p, i) => {
    const [x0, y0] = pt(i * seg, r);
    const [x1, y1] = pt((i + 1) * seg, r);
    const mid = (i + 0.5) * seg;
    const [tx, ty] = pt(mid, 90);
    const [dx, dy] = pt(i * seg, 122); // stud on each segment boundary
    const color = p.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const label = p.label.length > 16 ? p.label.slice(0, 15) + '…' : p.label;
    const textFill = brightness(color) > 130 ? '#23212b' : '#ffffff';
    // Radial labels; flip the left half 180° so no label reads upside-down.
    const textRot = mid > 180 ? mid + 90 : mid - 90;
    return `
      <path d="M${R},${R} L${x0.toFixed(2)},${y0.toFixed(2)} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z"
            fill="${color}" stroke="${ink}" stroke-width="2" opacity="${p.soldOut ? 0.35 : 1}"/>
      <circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="2.2" fill="${surface}" stroke="${ink}" stroke-width="1"/>
      <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${textRot.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})"
            text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-size="11.5"
            font-weight="600" letter-spacing=".3">${label}</text>`;
  });
  $('wheelSvg').innerHTML =
    `<circle cx="${R}" cy="${R}" r="${r}" fill="${surface}"/>` +
    parts.join('') +
    `<circle cx="${R}" cy="${R}" r="52" fill="${surface}" stroke="${ink}" stroke-width="2"/>`;
}

async function spinWheel() {
  if (state.busy) return;
  state.busy = true;
  $('spinBtn').disabled = true;
  try {
    const result = await requestDraw('wheel');
    const seg = 360 / state.campaign.prizes.length;
    // Land the winning segment's centre under the top pointer (+ small jitter
    // so it doesn't always stop dead-centre), after 5 dramatic full turns.
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const target = (360 - (result.prizeIndex + 0.5) * seg + jitter + 360) % 360;
    const current = ((state.rot % 360) + 360) % 360;
    state.rot += 360 * 5 + ((target - current + 360) % 360);
    const svg = $('wheelSvg');
    svg.style.transform = `rotate(${state.rot}deg)`;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.busy = false;
      $('spinBtn').disabled = false;
      showResult(result);
    };
    svg.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 5200); // fallback if transitionend never fires
  } catch (e) {
    state.busy = false;
    $('spinBtn').disabled = false;
    toast(e.message);
  }
}

/* ── เกม 2: เซียมซี ────────────────────────────────────────────────────────── */
async function shakeSticks() {
  if (state.busy) return;
  state.busy = true;
  $('shakeBtn').disabled = true;
  const cyl = $('cylinder');
  cyl.classList.remove('revealed');
  try {
    const result = await requestDraw('sticks');
    cyl.classList.add('shaking');
    setTimeout(() => {
      cyl.classList.remove('shaking');
      $('stickNum').textContent = result.fortune.number;
      cyl.classList.add('revealed');
      setTimeout(() => {
        state.busy = false;
        $('shakeBtn').disabled = false;
        showResult(result);
      }, 1100);
    }, 1800);
  } catch (e) {
    state.busy = false;
    $('shakeBtn').disabled = false;
    toast(e.message);
  }
}

/* ── เกม 3: เปิดไพ่ ────────────────────────────────────────────────────────── */
function dealCards() {
  $('redealBtn').classList.add('hidden');
  $('cardRow').innerHTML = Array.from({ length: 5 }, (_, i) => `
    <div class="tcard" data-i="${i}">
      <div class="inner">
        <div class="tface back"></div>
        <div class="tface front"><div class="art"></div><div class="nm"></div></div>
      </div>
    </div>`).join('');
  for (const el of document.querySelectorAll('.tcard')) {
    el.addEventListener('click', () => pickCard(el));
  }
}

// Emoji card art fits the sticker theme.
const cardGlyph = (f) => f.emoji;

async function pickCard(el) {
  if (state.busy || el.classList.contains('flipped')) return;
  state.busy = true;
  try {
    const result = await requestDraw('cards');
    el.querySelector('.art').textContent = cardGlyph(result.fortune);
    el.querySelector('.nm').textContent = result.fortune.name;
    for (const other of document.querySelectorAll('.tcard')) {
      other.classList.toggle('dimmed', other !== el);
    }
    el.classList.add('flipped');
    setTimeout(() => {
      state.busy = false;
      $('redealBtn').classList.remove('hidden');
      showResult(result);
    }, 1000);
  } catch (e) {
    state.busy = false;
    toast(e.message);
  }
}

/* ── ผลรางวัล ─────────────────────────────────────────────────────────────── */
function confetti() {
  const glyphs = ['🎉', '✨', '💖', '⚡', '🌟', '💜'];
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = glyphs[i % glyphs.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.fontSize = 14 + Math.random() * 12 + 'px';
    s.style.animationDuration = 2.2 + Math.random() * 2.2 + 's';
    s.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 5500);
  }
}

function showResult(result) {
  setPlaysLeft(result.remainingToday);

  const f = result.fortune;
  $('fortuneBox').innerHTML = !f ? '' : f.type === 'siamsi' ? `
    <div class="fortune-slip">
      <div class="f-seal">มงคล</div>
      <div class="f-head">ใบเซียมซี · หมายเลข ${f.number}</div>
      <div class="f-tone">${f.tone}</div>
      <div class="f-text">${f.text}</div>
    </div>` : `
    <div class="fortune-slip">
      <div class="f-art">${cardGlyph(f)}</div>
      <div class="f-en">${f.name}</div>
      <div class="f-text" style="margin-top:8px">${f.meaning}</div>
    </div>`;

  if (result.prize.win) {
    $('prizeBox').innerHTML = `
      <div class="orn win">ยินดีด้วย 🎉</div>
      <div class="prize-title">คุณได้รับ</div>
      <div class="prize-name">${result.prize.label}</div>`;
    confetti();
  } else {
    $('prizeBox').innerHTML = `
      <div class="orn lose">เกือบได้แล้ว</div>
      <div class="prize-name lose">${result.prize.label}</div>
      <div class="prize-sub">${result.remainingToday > 0
        ? `ยังเหลือสิทธิ์อีก ${result.remainingToday} ครั้งวันนี้`
        : 'พรุ่งนี้กลับมาลุ้นใหม่อีกครั้ง'}</div>`;
  }

  $('couponBox').innerHTML = !result.couponCode ? '' : `
    <div class="coupon">
      <div class="c-label">โค้ดของคุณ — คัดลอกหรือบันทึกหน้าจอเก็บไว้</div>
      <div class="c-code">${result.couponCode}</div>
      <button id="copyBtn">คัดลอกโค้ด</button>
    </div>`;
  const copy = $('copyBtn');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(result.couponCode); toast('คัดลอกโค้ดแล้ว ✅'); }
    catch { toast('คัดลอกไม่สำเร็จ กรุณาแคปหน้าจอแทนค่ะ'); }
  });

  $('againBtn').textContent = result.remainingToday > 0 ? 'เล่นอีกครั้ง' : 'ปิด';
  $('modal').classList.remove('hidden');
}

/* ── เริ่มต้น ─────────────────────────────────────────────────────────────── */
function switchGame(game) {
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('active', b.dataset.game === game);
  }
  for (const g of ['wheel', 'sticks', 'cards']) {
    $(`game-${g}`).classList.toggle('hidden', g !== game);
  }
}

async function init() {
  try {
    const res = await fetch(`/api/play/${campaignId}?player=${encodeURIComponent(playerId)}`);
    if (!res.ok) throw new Error();
    state.campaign = await res.json();
  } catch {
    $('campaignName').textContent = 'ไม่พบแคมเปญนี้';
    toast('ลิงก์ไม่ถูกต้อง หรือแคมเปญสิ้นสุดแล้ว');
    return;
  }
  $('campaignName').textContent = state.campaign.name;
  applyTheme(state.campaign.theme);
  setPlaysLeft(state.campaign.remainingToday);

  // Show only the game skins this campaign enables.
  let first = null;
  for (const b of document.querySelectorAll('#tabs button')) {
    const enabled = state.campaign.games.includes(b.dataset.game);
    b.classList.toggle('hidden', !enabled);
    if (enabled && !first) first = b.dataset.game;
    b.addEventListener('click', () => switchGame(b.dataset.game));
  }
  if (first) switchGame(first);

  buildWheel();
  dealCards();
  $('spinBtn').addEventListener('click', spinWheel);
  $('shakeBtn').addEventListener('click', shakeSticks);
  $('redealBtn').addEventListener('click', dealCards);
  $('againBtn').addEventListener('click', () => {
    $('modal').classList.add('hidden');
    $('cylinder').classList.remove('revealed');
  });

  if (state.campaign.remainingToday <= 0) toast(ERRORS.daily_limit, 4000);
}

init();
