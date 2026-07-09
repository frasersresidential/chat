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
  gate_required: 'กรุณาลงทะเบียนก่อนเริ่มเล่น',
  bad_code: 'รหัสไม่ถูกต้อง กรุณาตรวจสอบกับเจ้าหน้าที่',
  missing_name: 'กรุณากรอกชื่อ - นามสกุล',
  missing_phone: 'กรุณากรอกเบอร์โทรศัพท์',
  bad_phone: 'กรุณากรอกเบอร์โทรให้ถูกต้อง (เฉพาะตัวเลข)',
  phone_used: 'เบอร์นี้ใช้สิทธิ์ลุ้นรางวัลไปแล้ว ขอบคุณที่ร่วมสนุก 🙏',
  no_code_configured: 'ยังไม่ได้ตั้งรหัสสำหรับกิจกรรมนี้',
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
  buildBanner(c);
}

/* ── Decorative campaign banner (SVG, theme-coloured) ──────────────────────── */
function buildBanner(c = {}) {
  const svg = $('bannerSvg');
  if (!svg) return;
  const red = c.accent || '#da291c';
  const gold = c.highlight || '#c9a557';
  const ink = c.ink || '#333f48';
  const surface = c.surface || '#ffffff';
  // 4-point sparkle centred at (cx,cy)
  const spark = (cx, cy, s, fill, op = 1) =>
    `<path transform="translate(${cx} ${cy})" opacity="${op}" fill="${fill}"
       d="M0 ${-s} C ${s * 0.16} ${-s * 0.16} ${s * 0.16} ${-s * 0.16} ${s} 0 C ${s * 0.16} ${s * 0.16} ${s * 0.16} ${s * 0.16} 0 ${s} C ${-s * 0.16} ${s * 0.16} ${-s * 0.16} ${s * 0.16} ${-s} 0 C ${-s * 0.16} ${-s * 0.16} ${-s * 0.16} ${-s * 0.16} 0 ${-s} Z"/>`;
  const coin = (cx, cy, r) => `<g transform="translate(${cx} ${cy})">
      <ellipse cx="0" cy="${r * 0.32}" rx="${r}" ry="${r * 0.9}" fill="${shade(gold, -0.42)}"/>
      <circle r="${r}" fill="url(#coinG)" stroke="${shade(gold, -0.28)}" stroke-width="1"/>
      <circle r="${r * 0.66}" fill="none" stroke="${shade(gold, -0.22)}" stroke-width="1" opacity=".7"/>
      <text y="${r * 0.42}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${r * 1.15}" font-weight="800" fill="${shade(gold, -0.42)}">฿</text>
    </g>`;
  const confetti = [
    [128, 34, red], [232, 30, gold], [96, 52, gold], [268, 52, red], [150, 20, ink], [214, 18, red],
  ].map(([x, y, f], i) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${f}" opacity=".85" transform="rotate(${i * 33} ${x + 3} ${y + 3})"/>`).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="ribbonG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${shade(red, 0.16)}"/>
        <stop offset="1" stop-color="${shade(red, -0.18)}"/>
      </linearGradient>
      <radialGradient id="coinG" cx="38%" cy="30%" r="78%">
        <stop offset="0" stop-color="${shade(gold, 0.6)}"/>
        <stop offset="55%" stop-color="${gold}"/>
        <stop offset="100%" stop-color="${shade(gold, -0.32)}"/>
      </radialGradient>
      <linearGradient id="txtG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="${shade(gold, 0.75)}"/>
      </linearGradient>
    </defs>

    <!-- confetti + sparkles -->
    ${confetti}
    ${spark(180, 16, 7, gold)}${spark(112, 26, 5, gold, .9)}${spark(248, 22, 6, gold, .9)}

    <!-- gift box (left) -->
    <g transform="translate(60 18)">
      <rect x="0" y="16" width="44" height="30" rx="4" fill="${red}" stroke="${gold}" stroke-width="1.6"/>
      <rect x="-4" y="9" width="52" height="12" rx="3" fill="${shade(red, 0.14)}" stroke="${gold}" stroke-width="1.6"/>
      <rect x="18" y="9" width="8" height="37" fill="${gold}"/>
      <path d="M22 9 C 8 -6 -1 7 22 9 C 45 7 36 -6 22 9 Z" fill="${gold}" stroke="${shade(gold, -0.25)}" stroke-width=".8"/>
    </g>

    <!-- coins (right) -->
    ${coin(286, 40, 15)}${coin(268, 30, 12)}${coin(300, 26, 10)}

    <!-- ribbon banner -->
    <path d="M34 76 L58 76 L58 104 L34 104 L44 90 Z" fill="${shade(red, -0.3)}"/>
    <path d="M326 76 L302 76 L302 104 L326 104 L316 90 Z" fill="${shade(red, -0.3)}"/>
    <rect x="52" y="62" width="256" height="46" rx="9" fill="url(#ribbonG)" stroke="${gold}" stroke-width="2.4"/>
    <rect x="57" y="67" width="246" height="36" rx="6" fill="none" stroke="${gold}" stroke-width="1" opacity=".5"/>
    ${spark(66, 85, 5, gold)}${spark(294, 85, 5, gold)}
    <text x="180" y="93" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="25" font-weight="800" letter-spacing="4" fill="url(#txtG)" style="paint-order:stroke;stroke:${shade(red, -0.4)};stroke-width:.6px">LUCKY DRAW</text>

    <!-- little sparkles under banner -->
    ${spark(150, 124, 5, gold, .85)}${spark(210, 126, 4, gold, .7)}${spark(180, 132, 6, red, .8)}`;
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

/** Darken (amt<0) or lighten (amt>0) a hex color for the 3D shading. */
function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  const ch = (x) => Math.round(amt < 0 ? x * (1 + amt) : x + (255 - x) * amt);
  const r = ch((v >> 16) & 255), g = ch((v >> 8) & 255), b = ch(v & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Carnival-style 3D wheel: thick shaded rim with light bulbs, glossy segments
// with white separators, dark glossy hub and an integrated teardrop pointer.
// All colors come from the campaign theme, so it restyles from the admin.
function buildWheel() {
  const prizes = state.campaign.prizes;
  const tc = state.campaign.theme?.colors || {};
  const surface = tc.surface || '#ffffff';
  const accent = tc.accent || '#da291c';
  const accent2 = tc.accent2 || '#333f48';
  const highlight = tc.highlight || '#c9a557';
  const n = prizes.length;
  const seg = 360 / n;
  const C = 160, segR = 134;
  const pt = (deg, rad) => {
    const a = (deg * Math.PI) / 180;
    return [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  };
  const segs = prizes.map((p, i) => {
    const [x0, y0] = pt(i * seg, segR);
    const [x1, y1] = pt((i + 1) * seg, segR);
    const mid = (i + 0.5) * seg;
    const [tx, ty] = pt(mid, 89);
    const color = p.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const label = p.label.length > 18 ? p.label.slice(0, 17) + '…' : p.label;
    // Shrink long labels so they stay inside the ~80px radial span (hub → rim).
    const fs = label.length > 14 ? 9 : label.length > 11 ? 10.5 : 12;
    const textFill = brightness(color) > 130 ? shade(accent, -0.15) : '#ffffff';
    // Radial labels; flip the left half 180° so no label reads upside-down.
    const textRot = mid > 180 ? mid + 90 : mid - 90;
    return `
      <path d="M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${segR} ${segR} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z"
            fill="${color}" stroke="${surface}" stroke-width="2.5" opacity="${p.soldOut ? 0.35 : 1}"/>
      <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${textRot.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})"
            text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-size="${fs}"
            font-weight="700" letter-spacing=".3">${label}</text>`;
  }).join('');

  // 16 light bulbs seated in the (now slimmer) rim. Each carries its index in
  // --d so the CSS chase animation can stagger them while the wheel spins.
  const NBULB = 16;
  const bulbs = Array.from({ length: NBULB }, (_, i) => {
    const [x, y] = pt(i * (360 / NBULB), 141);
    return `<circle class="bulb" style="--d:${i}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.3" fill="url(#bulbGrad)" stroke="${shade(accent, -0.5)}" stroke-width=".7"/>`;
  }).join('');

  const defs = `<defs>
    <radialGradient id="rimGrad" cx="35%" cy="22%" r="95%">
      <stop offset="0%" stop-color="${shade(accent, 0.28)}"/>
      <stop offset="55%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="${shade(accent, -0.45)}"/>
    </radialGradient>
    <radialGradient id="hubGrad" cx="38%" cy="28%" r="85%">
      <stop offset="0%" stop-color="${shade(accent2, 0.35)}"/>
      <stop offset="60%" stop-color="${accent2}"/>
      <stop offset="100%" stop-color="${shade(accent2, -0.55)}"/>
    </radialGradient>
    <radialGradient id="bulbGrad" cx="35%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#fff8e1"/>
      <stop offset="45%" stop-color="${highlight}"/>
      <stop offset="100%" stop-color="${shade(highlight, -0.35)}"/>
    </radialGradient>
    <radialGradient id="glossGrad" cx="38%" cy="24%" r="80%">
      <stop offset="0%" stop-color="rgba(255,255,255,.32)"/>
      <stop offset="45%" stop-color="rgba(255,255,255,.05)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,.14)"/>
    </radialGradient>
  </defs>`;

  $('wheelSvg').innerHTML = defs +
    `<circle cx="${C}" cy="${C}" r="${segR}" fill="${surface}"/>` +
    `<g id="wheelRot" style="transform-origin:${C}px ${C}px">${segs}</g>` +
    `<circle cx="${C}" cy="${C}" r="${segR}" fill="url(#glossGrad)" pointer-events="none"/>` +
    `<circle cx="${C}" cy="${C}" r="141" fill="none" stroke="url(#rimGrad)" stroke-width="14"/>` +
    `<circle cx="${C}" cy="${C}" r="148" fill="none" stroke="${shade(accent, -0.55)}" stroke-width="1.6"/>` +
    `<circle cx="${C}" cy="${C}" r="134.5" fill="none" stroke="${highlight}" stroke-width="1.2" opacity=".85"/>` +
    bulbs +
    // Small sharp pointer triangle rising from behind the top of the GO button.
    `<path d="M${C} 94 L${C - 12} 138 L${C + 12} 138 Z" fill="url(#hubGrad)" stroke="${highlight}" stroke-width="1.6"/>` +
    `<circle cx="${C}" cy="${C}" r="34" fill="url(#hubGrad)" stroke="${highlight}" stroke-width="2.2"/>` +
    `<circle cx="${C}" cy="${C}" r="28.5" fill="none" stroke="${highlight}" stroke-width="1" opacity=".55"/>`;

  // Keep the current rotation when the wheel is rebuilt (e.g. theme change).
  const rot = document.getElementById('wheelRot');
  if (rot && state.rot) rot.style.transform = `rotate(${state.rot}deg)`;
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
    const rot = document.getElementById('wheelRot');
    const wrap = document.querySelector('.wheel-wrap');
    wrap.classList.add('spinning'); // kicks off the bulb chase animation
    rot.style.transform = `rotate(${state.rot}deg)`;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wrap.classList.remove('spinning');
      state.busy = false;
      $('spinBtn').disabled = false;
      showResult(result);
    };
    rot.addEventListener('transitionend', finish, { once: true });
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
// Sparkle rain tinted with the campaign's own prize colors so it matches any theme.
function confetti() {
  const glyphs = ['✦', '●', '✧', '▪'];
  const colors = (state.campaign?.prizes || []).map((p) => p.color).filter(Boolean);
  if (!colors.length) colors.push('#c9a557');
  for (let i = 0; i < 24; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = i % 6 === 0 ? '🎉' : glyphs[i % glyphs.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.color = colors[i % colors.length];
    s.style.fontSize = 11 + Math.random() * 10 + 'px';
    s.style.animationDuration = 2.4 + Math.random() * 2.2 + 's';
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

/* ── หน้าแรก: ฟอร์มลงทะเบียน + ค้นหาโครงการ ────────────────────────────────── */
function setupProjectCombo(projects) {
  const input = $('fProject');
  const list = $('projList');
  const render = (items) => {
    if (!items.length) { list.classList.add('hidden'); return; }
    list.innerHTML = items.map((p) => `<button type="button" class="combo-opt">${p.replace(/</g, '&lt;')}</button>`).join('');
    list.classList.remove('hidden');
  };
  const filter = () => {
    const q = input.value.trim().toLowerCase();
    render(projects.filter((p) => p.toLowerCase().includes(q)).slice(0, 40));
  };
  input.addEventListener('focus', filter);
  input.addEventListener('input', filter);
  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.combo-opt');
    if (!opt) return;
    input.value = opt.textContent;
    list.classList.add('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!$('projField').contains(e.target)) list.classList.add('hidden');
  });
}

function showEntry() {
  $('entry').classList.remove('hidden');
  $('playArea').classList.add('hidden');
  $('playsLine').classList.add('hidden');
}

function showPlay() {
  $('entry').classList.add('hidden');
  $('playArea').classList.remove('hidden');
  $('playsLine').classList.remove('hidden');
  setPlaysLeft(state.campaign.remainingToday);
  if (state.campaign.remainingToday <= 0) toast(ERRORS.daily_limit, 4000);
}

function setupEntryForm() {
  setupProjectCombo(state.campaign.gate?.projects || []);
  // Phone: digits only — strip anything else as the user types.
  const phone = $('fPhone');
  if (phone) phone.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g, '').slice(0, 15);
    if (digits !== phone.value) phone.value = digits;
  });
  $('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('entryErr');
    err.classList.add('hidden');
    const payload = {
      playerId,
      name: $('fName').value.trim(),
      phone: $('fPhone').value.trim(),
      project: $('fProject').value.trim(),
      plot: $('fPlot').value.trim(),
      code: $('fCode').value.trim(),
    };
    $('entryNext').disabled = true;
    try {
      const res = await fetch(`/api/play/${campaignId}/enter`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(ERRORS[data.error] || 'ลงทะเบียนไม่สำเร็จ ลองใหม่อีกครั้ง');
      showPlay();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    } finally {
      $('entryNext').disabled = false;
    }
  });
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

  // One game per link — the admin picks it; the customer just plays it.
  const game = state.campaign.game || 'wheel';
  for (const g of ['wheel', 'sticks', 'cards']) {
    $(`game-${g}`).classList.toggle('hidden', g !== game);
  }
  if (game === 'wheel') buildWheel();
  if (game === 'cards') dealCards();
  $('spinBtn').addEventListener('click', spinWheel);
  $('shakeBtn').addEventListener('click', shakeSticks);
  $('redealBtn').addEventListener('click', dealCards);
  $('againBtn').addEventListener('click', () => {
    $('modal').classList.add('hidden');
    $('cylinder').classList.remove('revealed');
  });

  // Gate: registered players (or gate-off campaigns) skip straight to the game.
  setupEntryForm();
  if (state.campaign.gate?.enabled && !state.campaign.entered) showEntry();
  else showPlay();
}

init();
