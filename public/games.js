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
  daily_limit: 'วันนี้ใช้สิทธิ์ครบแล้ว พรุ่งนี้กลับมาลุ้นใหม่นะ 🌙',
  campaign_inactive: 'แคมเปญนี้สิ้นสุดแล้ว ขอบคุณที่ร่วมสนุกค่ะ 🙏',
  no_prizes: 'ของรางวัลถูกแจกหมดแล้ว ขออภัยด้วยนะคะ',
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

/* ── เกม 1: วงล้อ ──────────────────────────────────────────────────────────── */
// Muted lacquer tones; the top-value prize segment is picked out in gold.
const FALLBACK_COLORS = ['#b2882e', '#22222c', '#1d2733', '#20291f', '#2c2029', '#191920'];

/** Perceived brightness 0-255 from a #rrggbb hex. */
function brightness(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114;
}

function buildWheel() {
  const prizes = state.campaign.prizes;
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
    const [dx, dy] = pt(i * seg, 122); // gold stud on each segment boundary
    const color = p.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    const label = p.label.length > 16 ? p.label.slice(0, 15) + '…' : p.label;
    const textFill = brightness(color) > 110 ? '#241a08' : '#d9c690';
    // Radial labels; flip the left half 180° so no label reads upside-down.
    const textRot = mid > 180 ? mid + 90 : mid - 90;
    return `
      <path d="M${R},${R} L${x0.toFixed(2)},${y0.toFixed(2)} A${r} ${r} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z"
            fill="${color}" stroke="#d4b26a" stroke-width="0.8" opacity="${p.soldOut ? 0.35 : 1}"/>
      <circle cx="${dx.toFixed(2)}" cy="${dy.toFixed(2)}" r="1.8" fill="#d4b26a" opacity=".9"/>
      <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" transform="rotate(${textRot.toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})"
            text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-size="11"
            font-weight="500" letter-spacing=".5">${label}</text>`;
  });
  $('wheelSvg').innerHTML =
    `<circle cx="${R}" cy="${R}" r="${r}" fill="#101016"/>` +
    parts.join('') +
    `<circle cx="${R}" cy="${R}" r="${r}" fill="none" stroke="#d4b26a" stroke-width="1" opacity=".55"/>` +
    `<circle cx="${R}" cy="${R}" r="50" fill="#101015" stroke="#d4b26a" stroke-width="0.8"/>` +
    `<circle cx="${R}" cy="${R}" r="46" fill="none" stroke="#d4b26a" stroke-width="0.5" opacity=".5"/>`;
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

// Classic engraved glyphs per card — the raw emoji reads too playful here.
const CARD_GLYPHS = { sun: '☀', star: '✶', moon: '☽', wheel: '✵', lovers: '♥', strength: '♛', world: '❖', fool: '➶' };
const cardGlyph = (f) => CARD_GLYPHS[f.key] || f.emoji;

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
// Restrained gold-sparkle rain instead of party-emoji confetti.
function confetti() {
  const glyphs = ['✦', '✧', '·'];
  const colors = ['#ecd9a8', '#d4b26a', '#a8863d'];
  for (let i = 0; i < 22; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = glyphs[i % glyphs.length];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.color = colors[i % colors.length];
    s.style.fontSize = 9 + Math.random() * 9 + 'px';
    s.style.animationDuration = 2.6 + Math.random() * 2.4 + 's';
    s.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 6000);
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
      <div class="orn">✦ ✦ ✦</div>
      <div class="prize-title">ยินดีด้วย คุณได้รับ</div>
      <div class="prize-name">${result.prize.label}</div>`;
    confetti();
  } else {
    $('prizeBox').innerHTML = `
      <div class="orn">✦</div>
      <div class="prize-title">ครั้งนี้ยังไม่ใช่ของคุณ</div>
      <div class="prize-name lose">${result.prize.label}</div>
      <div class="prize-sub">${result.remainingToday > 0
        ? `ยังเหลือสิทธิ์อีก ${result.remainingToday} ครั้งในวันนี้`
        : 'พรุ่งนี้กลับมาลุ้นกันใหม่อีกครั้ง'}</div>`;
  }

  $('couponBox').innerHTML = !result.couponCode ? '' : `
    <div class="coupon">
      <div class="c-label">โค้ดรับสิทธิ์ของคุณ — คัดลอกหรือบันทึกหน้าจอไว้</div>
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
