// Ad Spy dashboard — zero-build vanilla SPA.
const state = {
  token: null,
  config: null,
  tab: 'feed',
  competitorId: '',
  sort: 'longest',
  q: '',
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: state.token ? 'Bearer ' + state.token : '', ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'request failed');
  }
  return res.status === 204 ? null : res.json();
}
function logout() {
  localStorage.removeItem('adspy_token');
  location.reload();
}

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin(err) {
  $('#app').classList.add('hidden');
  let ov = document.getElementById('loginOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'loginOverlay'; document.body.appendChild(ov); }
  ov.className = 'login-overlay';
  ov.innerHTML = `<form class="login-card" id="loginForm">
    <div class="login-brand">🕵️ Ad Spy</div>
    <div class="login-sub">สอดแนมโฆษณาคู่แข่งบน Facebook</div>
    ${err ? `<div class="login-err">${esc(err)}</div>` : ''}
    <input id="liPass" type="password" placeholder="รหัสผ่าน" value="spy1234" autocomplete="current-password" />
    <button class="btn" type="submit">เข้าสู่ระบบ</button>
    <div class="login-hint">เดโม: รหัสผ่าน <b>spy1234</b><br/>(เปลี่ยนได้ที่ env <b>ADSPY_PASSWORD</b>)</div>
  </form>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: $('#liPass').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showLogin(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      localStorage.setItem('adspy_token', data.token);
      location.reload();
    } catch { showLogin('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
  };
}

// ── Web Push ──────────────────────────────────────────────────────────────────
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return alert('เบราว์เซอร์นี้ไม่รองรับ Web Push');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key, enabled } = await api('/push/key');
    if (!enabled || !key) return alert('ฝั่งเซิร์ฟเวอร์ยังไม่ได้เปิด Web Push');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    $('#pushBtn').textContent = '🔔 เปิดแจ้งเตือนแล้ว';
  } catch (e) { console.warn('push subscribe failed', e); alert('เปิดแจ้งเตือนไม่สำเร็จ'); }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function boot() {
  state.token = localStorage.getItem('adspy_token');
  if (!state.token) return showLogin();
  try {
    state.config = await api('/config');
  } catch {
    localStorage.removeItem('adspy_token');
    return showLogin();
  }
  $('#app').classList.remove('hidden');
  const pill = $('#modePill');
  pill.textContent = state.config.live ? '🟢 LIVE · Ad Library' : '🟡 MOCK · ข้อมูลตัวอย่าง';
  pill.classList.toggle('live', state.config.live);
  pill.title = state.config.live
    ? 'ต่อกับ Meta Ad Library จริง'
    : 'โหมดตัวอย่าง — ใส่ META_AD_LIBRARY_TOKEN เพื่อดึงข้อมูลจริง';
  $('#pushBtn').onclick = enablePush;
  $('#logoutBtn').onclick = logout;
  $('#refreshBtn').onclick = async () => {
    $('#refreshBtn').textContent = '… กำลังอัปเดต';
    try { const r = await api('/refresh', { method: 'POST' }); alert(`✓ อัปเดต ${r.competitors} เพจ — โฆษณาใหม่รวม ${r.newAds} ชิ้น`); }
    catch (e) { alert(e.message); }
    $('#refreshBtn').textContent = '↻ อัปเดตทั้งหมด';
    render();
  };
  render();
}

// ── Render ───────────────────────────────────────────────────────────────────
const PLATFORM_ICON = { facebook: '📘', instagram: '📷', messenger: '💬', audience_network: '🌐', threads: '🧵' };
const MEDIA_ICON = { image: '🖼️', video: '🎬', carousel: '🎠', unknown: '📄' };

function adThumb(ad) {
  const color = ad.imageColor || '#1f6feb';
  return `<button class="ad-thumb as-btn" data-preview="${ad.id}" style="background:linear-gradient(135deg,${color},${color}bb)" title="โหลดครีเอทีฟจริงของโฆษณานี้">
    <span>${MEDIA_ICON[ad.mediaType] || '📄'} ▶ ดูครีเอทีฟจริง</span></button>`;
}

function adCard(ad) {
  const runningCls = ad.daysRunning >= 60 ? 'hot' : ad.daysRunning >= 21 ? 'warm' : '';
  return `<div class="ad-card ${ad.status !== 'active' ? 'inactive' : ''}">
    ${adThumb(ad)}
    <div class="ad-body">
      <div class="ad-top">
        <span class="ad-page">${esc(ad.pageName)}</span>
        <span class="ad-days ${runningCls}" title="ระยะเวลาที่รันโฆษณา">🔥 ${ad.daysRunning}d</span>
      </div>
      ${ad.headline ? `<div class="ad-headline">${esc(ad.headline)}</div>` : ''}
      <div class="ad-copy">${esc((ad.body || '').slice(0, 180))}${(ad.body || '').length > 180 ? '…' : ''}</div>
      <div class="ad-meta">
        ${ad.cta ? `<span class="chip cta">▶ ${esc(ad.cta)}</span>` : ''}
        ${(ad.platforms || []).map((p) => `<span class="chip">${PLATFORM_ICON[p] || ''} ${esc(p)}</span>`).join('')}
        ${ad.status !== 'active' ? '<span class="chip unassigned">หยุดแล้ว</span>' : ''}
      </div>
      <div class="ad-actions">
        <button class="btn ghost ad-save ${ad.saved ? 'saved' : ''}" data-save="${ad.id}" data-next="${ad.saved ? '0' : '1'}">${ad.saved ? '★ บันทึกแล้ว' : '☆ เก็บเข้าคลัง'}</button>
        ${ad.linkUrl ? `<a class="btn ghost" href="${esc(ad.linkUrl)}" target="_blank" rel="noopener">${ad.linkUrl.includes('facebook.com/ads/library') ? '🔍 Ad Library ↗' : '🔗 Landing'}</a>` : ''}
      </div>
    </div>
  </div>`;
}

async function render() {
  const main = $('#main');
  let competitors;
  try { competitors = await api('/competitors'); }
  catch (e) { main.innerHTML = `<div class="admin"><p class="muted">${esc(e.message)}</p></div>`; return; }

  const tabs = [['feed', '📰 ฟีดโฆษณา'], ['winning', '🔥 แอดที่เวิร์ก'], ['swipe', '★ คลังไอเดีย'], ['insights', '🧠 วิเคราะห์']];

  main.innerHTML = `<div class="admin">
    <p class="muted" style="margin-top:0">ข้อมูลจาก <b>Meta Ad Library</b> สาธารณะ (ไม่ใช่การ scrape) — ดูครีเอทีฟ, CTA, แพลตฟอร์ม และ<b>ระยะเวลาที่รันโฆษณา</b> ซึ่งเป็นสัญญาณว่าแอดไหนน่าจะกำไร คลังโฆษณาไม่เปิดเผยงบ/ยอดวิวสำหรับแอดขายทั่วไป</p>

    <div class="card">
      <h3>🎯 คู่แข่งที่เฝ้าดู (${competitors.length})</h3>
      <div class="competitor-grid">
        ${competitors.map((c) => `<div class="competitor-chip ${state.competitorId === c.id ? 'active' : ''}" data-cmp="${c.id}">
          <div class="cc-top"><b>${esc(c.pageName)}</b> ${c.alertsEnabled ? '🔔' : '🔕'}</div>
          <div class="cc-stats"><span title="แอดที่กำลังรัน">▶ ${c.activeAds}</span> · <span title="ใหม่สัปดาห์นี้">✨ ${c.newThisWeek}</span> · <span title="รันนานสุด (วัน)">🔥 ${c.longestRunning}d</span></div>
          <div class="cc-actions">
            <button class="btn ghost" data-cmp-refresh="${c.id}" title="อัปเดต">↻</button>
            <button class="btn ghost" data-cmp-alerts="${c.id}" data-next="${c.alertsEnabled ? '0' : '1'}" title="เปิด/ปิดแจ้งเตือน">${c.alertsEnabled ? '🔔' : '🔕'}</button>
            <button class="btn ghost" data-cmp-del="${c.id}" title="ลบ">✕</button>
          </div>
        </div>`).join('') || '<span class="muted">ยังไม่มีคู่แข่งในรายการ — เพิ่มด้านล่าง</span>'}
      </div>
      <div class="form-grid" style="margin-top:12px">
        <div><label>ชื่อเพจคู่แข่ง</label><input id="cmpName" placeholder="เช่น Sansiri" /></div>
        <div><label>Page ID (ไม่บังคับในโหมด mock / จำเป็นสำหรับข้อมูลจริง)</label><input id="cmpPage" placeholder="เช่น 112233445566" /></div>
        <div><label>ประเทศ</label><input id="cmpCountry" value="${esc(state.config.defaultCountry)}" style="width:80px" maxlength="2" /></div>
        <div><button class="btn" id="cmpAdd">+ เพิ่มคู่แข่ง</button></div>
      </div>
      <div class="muted" id="cmpMsg" style="font-size:12px"></div>
    </div>

    <div class="tabs" id="tabs">
      ${tabs.map(([k, label]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="body"></div>
  </div>`;

  // Watchlist wiring
  main.querySelectorAll('[data-cmp]').forEach((el) => el.onclick = (e) => {
    if (e.target.closest('button')) return;
    state.competitorId = state.competitorId === el.dataset.cmp ? '' : el.dataset.cmp;
    render();
  });
  main.querySelectorAll('[data-cmp-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('ลบคู่แข่งรายนี้และโฆษณาที่เก็บไว้?')) return;
    await api('/competitors/' + b.dataset.cmpDel, { method: 'DELETE' });
    if (state.competitorId === b.dataset.cmpDel) state.competitorId = '';
    render();
  });
  main.querySelectorAll('[data-cmp-refresh]').forEach((b) => b.onclick = async () => {
    b.textContent = '…';
    try { const r = await api('/competitors/' + b.dataset.cmpRefresh + '/refresh', { method: 'POST' }); $('#cmpMsg').textContent = `✓ อัปเดตแล้ว — โฆษณาใหม่ ${r.newAds} ชิ้น`; }
    catch (e) { alert(e.message); }
    render();
  });
  main.querySelectorAll('[data-cmp-alerts]').forEach((b) => b.onclick = async () => {
    await api('/competitors/' + b.dataset.cmpAlerts, { method: 'PUT', body: JSON.stringify({ alertsEnabled: b.dataset.next === '1' }) });
    render();
  });
  $('#cmpAdd').onclick = async () => {
    const pageName = $('#cmpName').value.trim();
    if (!pageName) return;
    $('#cmpAdd').disabled = true;
    try {
      await api('/competitors', { method: 'POST', body: JSON.stringify({ pageName, pageId: $('#cmpPage').value.trim(), country: $('#cmpCountry').value.trim() }) });
      render();
    } catch (e) { $('#cmpMsg').textContent = '✕ ' + e.message; $('#cmpAdd').disabled = false; }
  };
  main.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; render(); });

  renderBody($('#body'), competitors);
}

async function renderBody(box, competitors) {
  if (!box) return;
  const cmpName = state.competitorId ? (competitors.find((c) => c.id === state.competitorId)?.pageName || '') : 'ทุกคู่แข่ง';

  if (state.tab === 'insights') return renderInsights(box, cmpName);

  box.innerHTML = '<div class="muted" style="padding:12px">กำลังโหลด…</div>';
  let ads = [];
  try {
    if (state.tab === 'winning') ads = await api('/winning?limit=30');
    else if (state.tab === 'swipe') ads = await api('/ads?saved=true&sort=newest' + (state.competitorId ? '&competitorId=' + state.competitorId : ''));
    else ads = await api(`/ads?sort=${state.sort}&q=${encodeURIComponent(state.q)}` + (state.competitorId ? '&competitorId=' + state.competitorId : ''));
  } catch (e) { box.innerHTML = `<p class="muted">โหลดไม่สำเร็จ: ${esc(e.message)}</p>`; return; }

  const controls = state.tab === 'feed' ? `<div class="ad-controls">
    <input id="adSearch" placeholder="🔍 ค้นหาในข้อความโฆษณา" value="${esc(state.q)}" />
    <select id="adSort">
      <option value="longest" ${state.sort === 'longest' ? 'selected' : ''}>รันนานสุดก่อน</option>
      <option value="winning" ${state.sort === 'winning' ? 'selected' : ''}>คะแนน "เวิร์ก" สูงสุด</option>
      <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>เจอใหม่ล่าสุด</option>
    </select>
  </div>` : '';

  const hint = state.tab === 'winning'
    ? `<p class="muted">แอดที่รันนานสุด = คู่แข่งยอมจ่ายต่อเนื่อง มักแปลว่าทำกำไร — ตัวที่ควรถอดสูตรมาลอง (${esc(cmpName)})</p>`
    : state.tab === 'swipe' ? `<p class="muted">ครีเอทีฟที่คุณกด ★ เก็บไว้เป็นคลังไอเดีย (${esc(cmpName)})</p>` : '';

  box.innerHTML = `${controls}${hint}
    <div class="ad-grid">${ads.length ? ads.map(adCard).join('') : `<p class="muted">${state.tab === 'swipe' ? 'ยังไม่มีโฆษณาที่บันทึกไว้ — กด ☆ ที่การ์ดใดก็ได้' : 'ยังไม่มีโฆษณา'}</p>`}</div>`;

  if ($('#adSearch')) {
    let t;
    $('#adSearch').oninput = (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => { state.q = v; renderBody(box, competitors); }, 300); };
  }
  if ($('#adSort')) $('#adSort').onchange = (e) => { state.sort = e.target.value; renderBody(box, competitors); };
  box.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
    try { await api('/ads/' + b.dataset.save + '/save', { method: 'POST', body: JSON.stringify({ saved: b.dataset.next === '1' }) }); }
    catch (e) { return alert(e.message); }
    renderBody(box, competitors);
  });
  // Swap the placeholder thumb for Meta's official creative preview on demand
  // (an iframe per card is heavy, so load only the ones the user asks for).
  box.querySelectorAll('[data-preview]').forEach((b) => b.onclick = () => {
    const frame = document.createElement('iframe');
    frame.className = 'ad-frame';
    frame.loading = 'lazy';
    frame.title = 'ตัวอย่างครีเอทีฟโฆษณา';
    frame.src = `/api/ads/${b.dataset.preview}/snapshot?t=${encodeURIComponent(state.token)}`;
    b.replaceWith(frame);
  });
}

async function renderInsights(box, cmpName) {
  box.innerHTML = '<div class="muted" style="padding:12px">กำลังวิเคราะห์…</div>';
  let ins;
  try { ins = await api('/insights' + (state.competitorId ? '?competitorId=' + state.competitorId : '')); }
  catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  const bar = (label, value, max, color = 'var(--accent)') =>
    `<div class="barrow"><span class="barlbl">${esc(label)}</span><span class="bartrack"><span class="barfill" style="width:${(value / max) * 100}%;background:${color}"></span></span><span class="barval">${value}</span></div>`;
  const maxW = Math.max(1, ...ins.topWords.map((w) => w.count));
  const maxC = Math.max(1, ...ins.ctas.map((c) => c.count));
  const maxP = Math.max(1, ...ins.platforms.map((p) => p.count));
  const maxCad = Math.max(1, ...ins.cadence.map((c) => c.count));
  const lb = ins.longevity; const maxL = Math.max(1, ...Object.values(lb));

  box.innerHTML = `<p class="muted">วิเคราะห์ครีเอทีฟของ <b>${esc(cmpName)}</b> — จาก ${ins.totalAds} โฆษณา (กำลังรัน ${ins.activeAds})</p>
    <div class="report-cols">
      <div class="card"><h3>🔑 คำที่คู่แข่งใช้บ่อย</h3>
        <div class="wordcloud">${ins.topWords.length ? ins.topWords.map((w) => `<span class="wc" style="font-size:${Math.round(90 + (w.count / maxW) * 55)}%" title="${w.count}×">${esc(w.label)}</span>`).join(' ') : '<span class="muted">—</span>'}</div>
      </div>
      <div class="card"><h3>▶ CTA ที่ใช้</h3>${ins.ctas.length ? ins.ctas.map((c) => bar(c.label, c.count, maxC, '#7c5cff')).join('') : '<p class="muted">—</p>'}</div>
    </div>
    <div class="report-cols">
      <div class="card"><h3>📱 แพลตฟอร์มที่ยิงแอด</h3>${ins.platforms.length ? ins.platforms.map((p) => bar((PLATFORM_ICON[p.label] || '') + ' ' + p.label, p.count, maxP, 'var(--green)')).join('') : '<p class="muted">—</p>'}</div>
      <div class="card"><h3>⏱️ อายุโฆษณา (วันที่รัน)</h3>
        ${bar('0–7 วัน (ทดสอบ)', lb['0-7'], maxL, '#8b949e')}
        ${bar('8–30 วัน', lb['8-30'], maxL, 'var(--accent)')}
        ${bar('31–90 วัน (เวิร์ก)', lb['31-90'], maxL, 'var(--orange)')}
        ${bar('90+ วัน (ตัวทำเงิน)', lb['90+'], maxL, 'var(--green)')}
      </div>
    </div>
    <div class="card"><h3>🚀 จังหวะปล่อยแอด (ต่อเดือน)</h3>
      ${ins.cadence.length ? ins.cadence.map((c) => bar(c.month, c.count, maxCad, '#0aa2c0')).join('') : '<p class="muted">—</p>'}</div>
    ${ins.topHooks.length ? `<div class="card"><h3>🎣 ประโยคเปิด (Hook) ที่ใช้ซ้ำ</h3>${ins.topHooks.map((h) => `<div class="hook-row"><span class="chip">${h.count}×</span> ${esc(h.label)}</div>`).join('')}</div>` : ''}
    <div style="height:24px"></div>`;
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:20px">Boot error: ${esc(e.message)}</pre>`; });
