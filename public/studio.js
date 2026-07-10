// Lucky Draw Studio — standalone admin for the gamification games.
// Separate from the OmniChat inbox; talks only to /api/games/* + /api/play/*.
const state = { token: null, user: null, permissions: [], view: 'games', selectedId: null };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const can = (perm) => state.permissions.includes(perm);

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
function logout() { localStorage.removeItem('studio_token'); location.reload(); }

// ── Login ──────────────────────────────────────────────────────────────────
function showLogin(err) {
  $('#app').classList.add('hidden');
  let ov = document.getElementById('loginOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'loginOverlay'; document.body.appendChild(ov); }
  ov.className = 'login-overlay';
  ov.innerHTML = `<form class="login-card" id="loginForm">
    <div class="login-brand">🎯 Lucky Draw Studio</div>
    <div class="login-sub">เข้าสู่ระบบเพื่อจัดการเกมและดูรายงาน</div>
    ${err ? `<div class="login-err">${esc(err)}</div>` : ''}
    <input id="liEmail" type="email" placeholder="อีเมล" value="u_owner@company-a.com" autocomplete="username" />
    <input id="liPass" type="password" placeholder="รหัสผ่าน" value="demo1234" autocomplete="current-password" />
    <button class="btn" type="submit" style="width:100%">เข้าสู่ระบบ</button>
    <div class="login-hint">เดโม: <b>u_owner@company-a.com</b> / <b>demo1234</b></div>
  </form>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: $('#liEmail').value, password: $('#liPass').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showLogin(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      localStorage.setItem('studio_token', data.token);
      location.reload();
    } catch { showLogin('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
  };
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function boot() {
  state.token = localStorage.getItem('studio_token');
  if (!state.token) return showLogin();
  let me;
  try { me = await api('/me'); }
  catch { localStorage.removeItem('studio_token'); return showLogin(); }
  state.user = me.user;
  state.permissions = me.permissions || [];
  document.getElementById('loginOverlay')?.remove();
  $('#app').classList.remove('hidden');
  $('#whoami').textContent = `${state.user.name} · ${state.user.role}`;
  $('#logoutBtn').onclick = logout;
  $('#nav').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      state.view = b.dataset.view;
      $('#nav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    };
  });
  render();
}

function render() {
  const main = $('#main');
  if (state.view === 'reports') return renderReports(main);
  return renderGames(main);
}

// ── Games tab — campaign configuration ───────────────────────────────────────
async function renderGames(main) {
  const [campaigns, presets] = await Promise.all([api('/games/campaigns'), api('/games/presets')]);
  const manage = can('manage_automation');
  const c = campaigns.find((x) => x.id === state.selectedId) || campaigns[0];

  if (!c) {
    main.innerHTML = `<div class="admin"><h2>Games — Lucky Draw</h2>
      <p class="muted">ยังไม่มีแคมเปญเกมสุ่มรางวัล</p>
      ${manage ? '<button class="btn" id="gNew">+ สร้างแคมเปญ</button>' : ''}</div>`;
    if (manage) $('#gNew').onclick = createGameCampaign;
    return;
  }
  state.selectedId = c.id;
  const t = c.theme || { colors: {}, style: {} };
  const gate = c.gate || { enabled: false, code: '', projects: [] };
  const dis = manage ? '' : 'disabled';
  const COLOR_LABELS = {
    bg: 'พื้นหลัง', surface: 'พื้นการ์ด', ink: 'ตัวอักษร / เส้นขอบ', muted: 'ตัวอักษรรอง',
    accent: 'สีหลัก (ปุ่ม / เข็ม / ป้าย)', accent2: 'สีรอง (แท็บ / กระบอกเซียมซี / หลังไพ่)', highlight: 'สีไฮไลต์ (ปุ่ม GO / ใบเซียมซี)',
  };
  const playUrl = `/games.html?c=${encodeURIComponent(c.id)}`;
  const fullUrl = location.origin + playUrl;
  const cGame = c.game || (Array.isArray(c.games) && c.games[0]) || 'wheel';
  const GAME_OPTS = [['wheel', 'วงล้อ (Spin Wheel)'], ['sticks', 'เซียมซี'], ['cards', 'เปิดไพ่ (Tarot)']];

  main.innerHTML = `<div class="admin">
    <h2>Games — Lucky Draw</h2>
    <p class="muted">1 แคมเปญ = 1 ลิงก์ = 1 เกม — เลือกเกม, ตั้งรางวัล/ธีม/โค้ดของแต่ละลิงก์แยกกัน แล้วส่งลิงก์ให้ลูกค้า (แนบ <code>?u=&lt;รหัสลูกค้า&gt;</code> เพื่อผูกสิทธิ์รายวัน)</p>

    <div class="card"><div class="form-grid">
      <div><label>แคมเปญ (ลิงก์)</label><select id="gSel">${campaigns.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div style="display:flex;align-items:flex-end;gap:8px">
        ${manage ? '<button class="btn ghost" id="gNew">+ สร้างลิงก์ใหม่</button>' : ''}
        <a class="btn" href="${playUrl}" target="_blank">เปิดหน้าเกม ↗</a>
      </div>
      <div style="grid-column:1/-1"><label>ลิงก์สำหรับลูกค้า</label>
        <div style="display:flex;gap:8px"><input id="gLink" value="${esc(fullUrl)}" readonly style="flex:1" /><button class="btn ghost" id="gCopyLink" type="button">คัดลอก</button></div>
      </div>
      <div><label>ชื่อแคมเปญ (ใช้ในระบบ — ไม่โชว์ลูกค้า)</label><input id="gName" value="${esc(c.name)}" ${dis} /></div>
      <div><label>ชื่อที่ลูกค้าเห็น (หัวข้อหน้าเกม)</label><input id="gDisplay" value="${esc(c.displayName || '')}" placeholder="เช่น ลุ้นโชคกับ Frasers Property" ${dis} /></div>
      <div><label>เกมของลิงก์นี้</label><select id="gGame" ${dis}>
        ${GAME_OPTS.map(([k, l]) => `<option value="${k}" ${k === cGame ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div><label>สถานะ</label><select id="gActive" ${dis}><option value="1" ${c.active !== false ? 'selected' : ''}>เปิดใช้งาน</option><option value="" ${c.active === false ? 'selected' : ''}>ปิด</option></select></div>
      <div><label>สิทธิ์ต่อคนต่อวัน</label><input id="gLimit" type="number" min="1" value="${c.limitPerDay ?? 3}" ${dis} /></div>
      <div><label>ล็อกผลรางวัล (ออกทุกครั้ง)</label><select id="gForced" ${dis}>
        <option value="">สุ่มตามน้ำหนัก (ปกติ)</option>
        ${(c.prizes || []).map((p) => `<option value="${p.id}" ${c.forcedPrizeId === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
      </select></div>
      <div style="grid-column:1/-1"><label>แบนเนอร์ (รูป PNG/JPG — ถ้าไม่ใส่จะใช้กราฟิกอัตโนมัติ)</label>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div id="gBannerPrev">${c.bannerUrl ? `<img src="${esc(c.bannerUrl)}" alt="banner" style="height:60px;border-radius:6px;border:1px solid var(--border)">` : '<span class="muted">ยังไม่มีรูป (ใช้กราฟิก LUCKY DRAW อัตโนมัติ)</span>'}</div>
          ${manage ? '<input type="file" id="gBannerFile" accept="image/png,image/jpeg,image/webp" /><button class="btn ghost" id="gBannerClear" type="button">ลบรูป</button>' : ''}
          <input type="hidden" id="gBanner" value="${esc(c.bannerUrl || '')}" />
        </div>
      </div>
    </div>
    ${c.forcedPrizeId ? `<p class="muted" style="margin:10px 0 0">🔒 ลิงก์นี้ล็อกให้ออกรางวัล “<b style="color:var(--text)">${esc((c.prizes || []).find((p) => p.id === c.forcedPrizeId)?.label || '')}</b>” ทุกครั้งที่เล่น</p>` : '<p class="muted" style="margin:10px 0 0">💡 อยากได้ลิงก์ที่ออกรางวัลตายตัว (เช่น 100,000 ทุกครั้ง)? เลือกที่ “ล็อกผลรางวัล” — ทำหลายลิงก์แยกรางวัลได้ แล้วเลือกส่งลิงก์ตามรางวัลที่ต้องการ</p>'}
    </div>

    <div class="card">
      <h3>ธีม & สี</h3>
      <p class="muted">เลือกชุดสำเร็จ แล้วปรับแต่ละสีต่อได้ — การเปลี่ยนแปลงมีผลกับหน้าเกมทันทีหลังบันทึก</p>
      <div style="display:flex;gap:8px;margin:10px 0 14px;flex-wrap:wrap">
        ${Object.entries(presets).map(([k, p]) => `<button class="btn ghost gPreset" data-preset="${k}" ${dis}
          style="border-color:${k === t.preset ? 'var(--accent)' : ''}">
          <span style="display:inline-flex;gap:3px;margin-right:6px;vertical-align:middle">
            ${['bg', 'accent', 'accent2', 'highlight'].map((ck) => `<i style="width:11px;height:11px;border-radius:3px;background:${p.colors[ck]};border:1px solid #0003"></i>`).join('')}
          </span>${p.label}</button>`).join('')}
      </div>
      <input type="hidden" id="gPresetVal" value="${t.preset || 'studio'}" />
      <div class="form-grid">
        ${Object.entries(COLOR_LABELS).map(([k, label]) => `
          <div><label>${label}</label><div style="display:flex;gap:8px;align-items:center">
            <input type="color" class="gColor" data-key="${k}" value="${t.colors?.[k] || '#ffffff'}" ${dis} style="width:44px;height:32px;padding:2px;border-radius:6px;border:1px solid #4443;background:none;cursor:pointer" />
            <code class="gColorHex" data-key="${k}">${t.colors?.[k] || ''}</code>
          </div></div>`).join('')}
        <div><label>มุมโค้ง (px)</label><input id="gRadius" type="number" min="0" max="32" value="${t.style?.radius ?? 14}" ${dis} /></div>
        <div><label>ความหนาเส้นขอบ (px)</label><input id="gBorder" type="number" min="0" max="4" step="0.5" value="${t.style?.borderWidth ?? 1.5}" ${dis} /></div>
        <div><label>สไตล์เงา</label><select id="gShadow" ${dis}>
          ${[['soft', 'นุ่ม (soft)'], ['hard', 'ตัดแข็งแบบสติกเกอร์ (hard)'], ['none', 'ไม่มีเงา']].map(([v, l]) => `<option value="${v}" ${t.style?.shadow === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div><label>ลายพื้นหลัง</label><select id="gPattern" ${dis}>
          ${[['none', 'เรียบ'], ['dots', 'ลายจุด']].map(([v, l]) => `<option value="${v}" ${t.style?.pattern === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
      </div>
    </div>

    <div class="card">
      <h3>รางวัล & โอกาสออก</h3>
      <p class="muted">weight = น้ำหนักการสุ่ม (ยิ่งมากยิ่งออกบ่อย) · สต็อกเว้นว่าง = ไม่จำกัด · สีใช้กับช่องบนวงล้อ</p>
      <table id="gPrizeTable">
        <thead><tr><th>รางวัล</th><th style="width:70px">weight</th><th style="width:70px">สต็อก</th><th style="width:52px">ถูกรางวัล</th><th style="width:56px">สี</th><th style="width:110px">prefix โค้ด</th>${manage ? '<th style="width:36px"></th>' : ''}</tr></thead>
        <tbody>${(c.prizes || []).map((p, i) => gamePrizeRow(p, i, manage)).join('')}</tbody>
      </table>
      ${manage ? '<button class="btn ghost" id="gAddPrize" style="margin-top:10px">+ เพิ่มรางวัล</button>' : ''}
    </div>

    <div class="card">
      <h3>หน้าลงทะเบียนก่อนเล่น</h3>
      <p class="muted">เปิดใช้เพื่อบังคับให้ลูกค้ากรอกฟอร์ม (ชื่อ-นามสกุล / โครงการ / แปลง) และใส่ Code ให้ตรงก่อนถึงจะเข้าเล่นได้</p>
      <div class="form-grid">
        <div><label>บังคับลงทะเบียน</label><select id="gGateOn" ${dis}>
          <option value="1" ${gate.enabled ? 'selected' : ''}>เปิด (ต้องกรอกฟอร์ม + Code)</option>
          <option value="" ${!gate.enabled ? 'selected' : ''}>ปิด (เข้าเล่นได้เลย)</option>
        </select></div>
        <div><label>Code เข้าร่วมกิจกรรม</label><input id="gGateCode" value="${esc(gate.code || '')}" placeholder="เช่น FP2024" ${dis} /></div>
        <div style="grid-column:1/-1"><label>รายชื่อโครงการ (บรรทัดละ 1 โครงการ — ใช้เป็น picklist ค้นหา)</label>
          <textarea id="gGateProjects" rows="5" ${dis} style="width:100%;font-family:inherit;padding:10px;border-radius:8px;border:1px solid var(--border,#3a3a4a);background:var(--card,#1b1b24);color:inherit">${esc((gate.projects || []).join('\n'))}</textarea></div>
      </div>
    </div>

    <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <h3 style="margin:0 0 4px">ผู้ลงทะเบียน &amp; ผลรางวัล</h3>
        <p class="muted" style="margin:0">ลงทะเบียน <b>${c.stats?.entries ?? 0}</b> คน · เล่นแล้ว <b>${c.stats?.totalDraws ?? 0}</b> คน · ถูกรางวัล <b>${c.stats?.wins ?? 0}</b> คน</p>
      </div>
      <button class="btn" id="gGoReports" type="button">ดูรายงานฉบับเต็ม →</button>
    </div>

    ${manage ? '<button class="btn" id="gSave">บันทึกแคมเปญ</button> <span id="gSaveMsg" class="muted"></span>' : ''}
  </div>`;

  $('#gSel').onchange = () => { state.selectedId = $('#gSel').value; renderGames(main); };
  $('#gGoReports').onclick = () => { state.view = 'reports'; $('#nav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'reports')); render(); };
  const gBannerFile = $('#gBannerFile');
  if (gBannerFile) gBannerFile.onchange = async () => {
    const file = gBannerFile.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('ไฟล์ใหญ่เกิน 5MB กรุณาย่อรูปก่อน'); return; }
    $('#gBannerPrev').innerHTML = '<span class="muted">กำลังอัปโหลด…</span>';
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), authorization: state.token ? 'Bearer ' + state.token : '' },
        body: file,
      });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json();
      $('#gBanner').value = url;
      $('#gBannerPrev').innerHTML = `<img src="${esc(url)}" alt="banner" style="height:60px;border-radius:6px;border:1px solid var(--border)">`;
    } catch (e) { $('#gBannerPrev').innerHTML = `<span class="muted">อัปโหลดไม่สำเร็จ: ${esc(e.message)}</span>`; }
  };
  const gBannerClear = $('#gBannerClear');
  if (gBannerClear) gBannerClear.onclick = () => {
    $('#gBanner').value = '';
    $('#gBannerPrev').innerHTML = '<span class="muted">ยังไม่มีรูป (ใช้กราฟิก LUCKY DRAW อัตโนมัติ)</span>';
    if (gBannerFile) gBannerFile.value = '';
  };
  $('#gCopyLink').onclick = async () => {
    try { await navigator.clipboard.writeText($('#gLink').value); $('#gCopyLink').textContent = '✓ คัดลอกแล้ว'; }
    catch { $('#gLink').select(); }
  };

  if (!manage) return;

  $('#gNew').onclick = createGameCampaign;
  $('#gAddPrize').onclick = () => {
    const tbody = main.querySelector('#gPrizeTable tbody');
    tbody.insertAdjacentHTML('beforeend', gamePrizeRow({ label: 'รางวัลใหม่', weight: 10, stock: null, win: true, color: '#4f46e5', couponPrefix: 'LUCKY' }, tbody.children.length, true));
    bindPrizeRowDeletes(main);
  };
  bindPrizeRowDeletes(main);

  main.querySelectorAll('.gPreset').forEach((b) => b.onclick = () => {
    const p = presets[b.dataset.preset];
    $('#gPresetVal').value = b.dataset.preset;
    main.querySelectorAll('.gColor').forEach((inp) => {
      inp.value = p.colors[inp.dataset.key];
      main.querySelector(`.gColorHex[data-key="${inp.dataset.key}"]`).textContent = p.colors[inp.dataset.key];
    });
    $('#gRadius').value = p.style.radius;
    $('#gBorder').value = p.style.borderWidth;
    $('#gShadow').value = p.style.shadow;
    $('#gPattern').value = p.style.pattern;
    main.querySelectorAll('.gPreset').forEach((x) => x.style.borderColor = x === b ? 'var(--accent)' : '');
  });
  main.querySelectorAll('.gColor').forEach((inp) => inp.oninput = () => {
    main.querySelector(`.gColorHex[data-key="${inp.dataset.key}"]`).textContent = inp.value;
  });

  $('#gSave').onclick = async () => {
    const colors = {};
    main.querySelectorAll('.gColor').forEach((inp) => colors[inp.dataset.key] = inp.value);
    const prizes = [...main.querySelectorAll('#gPrizeTable tbody tr')].map((tr) => ({
      id: tr.dataset.id || undefined,
      label: tr.querySelector('.pLabel').value,
      weight: Number(tr.querySelector('.pWeight').value) || 1,
      stock: tr.querySelector('.pStock').value === '' ? null : Number(tr.querySelector('.pStock').value),
      win: tr.querySelector('.pWin').checked,
      color: tr.querySelector('.pColor').value,
      couponPrefix: tr.querySelector('.pPrefix').value.trim() || null,
    }));
    try {
      await api('/games/campaigns/' + c.id, { method: 'POST', body: JSON.stringify({
        name: $('#gName').value,
        displayName: $('#gDisplay').value,
        bannerUrl: $('#gBanner').value || '',
        active: !!$('#gActive').value,
        limitPerDay: Number($('#gLimit').value) || 3,
        game: $('#gGame').value,
        forcedPrizeId: $('#gForced').value || null,
        theme: {
          preset: $('#gPresetVal').value,
          colors,
          style: { radius: Number($('#gRadius').value), borderWidth: Number($('#gBorder').value), shadow: $('#gShadow').value, pattern: $('#gPattern').value },
        },
        gate: {
          enabled: !!$('#gGateOn').value,
          code: $('#gGateCode').value.trim(),
          projects: $('#gGateProjects').value.split('\n').map((s) => s.trim()).filter(Boolean),
        },
        prizes,
      }) });
      // Flash survives the re-render below so the confirmation stays visible.
      state.flash = '✓ บันทึกแล้ว — กด “เปิดหน้าเกม ↗” เพื่อดูผลบนหน้าเกม';
      renderGames(main);
    } catch (e) { alert(e.message); }
  };

  if (state.flash) { const m = $('#gSaveMsg'); if (m) m.textContent = state.flash; state.flash = null; }
}

function gamePrizeRow(p, i, manage) {
  const dis = manage ? '' : 'disabled';
  return `<tr data-id="${p.id || ''}">
    <td><input class="pLabel" value="${esc(p.label || '')}" ${dis} /></td>
    <td><input class="pWeight" type="number" min="0" value="${p.weight ?? 1}" ${dis} /></td>
    <td><input class="pStock" type="number" min="0" value="${p.stock ?? ''}" placeholder="∞" ${dis} /></td>
    <td style="text-align:center"><input class="pWin" type="checkbox" ${p.win !== false ? 'checked' : ''} ${dis} /></td>
    <td><input class="pColor" type="color" value="${p.color || '#4f46e5'}" ${dis} style="width:36px;height:28px;padding:1px;border:1px solid #4443;border-radius:5px;background:none;cursor:pointer" /></td>
    <td><input class="pPrefix" value="${esc(p.couponPrefix || '')}" ${dis} /></td>
    ${manage ? '<td><button class="btn ghost pDel">✕</button></td>' : ''}
  </tr>`;
}

function bindPrizeRowDeletes(main) {
  main.querySelectorAll('.pDel').forEach((b) => b.onclick = () => b.closest('tr').remove());
}

async function createGameCampaign() {
  const created = await api('/games/campaigns', { method: 'POST', body: JSON.stringify({
    name: 'แคมเปญใหม่',
    prizes: [
      { label: 'ส่วนลด 100 บาท', weight: 10, stock: null, win: true, color: '#4f46e5', couponPrefix: 'LUCKY100' },
      { label: 'ขอบคุณที่ร่วมสนุก', weight: 30, stock: null, win: false, color: '#2c2a35' },
    ],
  }) });
  state.selectedId = created.id;
  renderGames($('#main'));
}

// ── Reports tab — registrants + prizes won ───────────────────────────────────
async function renderReports(main) {
  const campaigns = await api('/games/campaigns');
  const c = campaigns.find((x) => x.id === state.selectedId) || campaigns[0];

  if (!c) {
    main.innerHTML = `<div class="admin"><h2>Reports</h2><p class="muted">ยังไม่มีแคมเปญ — สร้างเกมในแท็บ Games ก่อน</p></div>`;
    return;
  }
  state.selectedId = c.id;

  main.innerHTML = `<div class="admin">
    <h2>Reports — ผู้ลงทะเบียน & ผลรางวัล</h2>
    <p class="muted">รายชื่อทุกคนที่กรอกฟอร์มเข้ามา พร้อมรางวัลที่หมุนได้ — ดาวน์โหลดเป็น CSV เปิดใน Excel ได้</p>

    <div class="card"><div class="form-grid">
      <div><label>เลือกแคมเปญ</label><select id="rSel">${campaigns.map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div style="display:flex;align-items:flex-end;gap:8px"><button class="btn" id="rExportCsv">⬇ ดาวน์โหลด CSV</button></div>
    </div>
    <p style="margin:12px 0 0">ลงทะเบียน <b>${c.stats?.entries ?? 0}</b> คน · เล่นแล้ว <b>${c.stats?.totalDraws ?? 0}</b> คน · ถูกรางวัล <b>${c.stats?.wins ?? 0}</b> คน</p>
    </div>

    <div class="card"><div id="rBox"><p class="muted">กำลังโหลด…</p></div></div>
  </div>`;

  $('#rSel').onchange = () => { state.selectedId = $('#rSel').value; renderReports(main); };

  const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  try {
    const { rows } = await api('/games/campaigns/' + c.id + '/report');
    const box = $('#rBox');
    if (!rows.length) { box.innerHTML = '<p class="muted">ยังไม่มีผู้ลงทะเบียน</p>'; }
    else box.innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th>ลงทะเบียน</th><th>ชื่อ-นามสกุล</th><th>เบอร์โทร</th><th>โครงการ</th><th>แปลง</th><th>เกม</th><th>รางวัลที่ได้</th><th>โค้ด</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${fmtWhen(r.registeredAt)}</td>
        <td>${esc(r.name || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td>${esc(r.project || '—')}</td>
        <td>${esc(r.plot || '—')}</td>
        <td>${r.played ? esc(r.game || '') : '<span class="muted">ยังไม่ได้เล่น</span>'}</td>
        <td>${!r.played ? '—' : r.win ? `<span class="pill">${esc(r.prize || 'ได้รางวัล')}</span>` : esc(r.prize || 'ไม่ได้รางวัล')}</td>
        <td>${r.couponCode ? `<code>${esc(r.couponCode)}</code>` : '—'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) { $('#rBox').innerHTML = `<p class="muted">โหลดไม่สำเร็จ: ${esc(e.message)}</p>`; }

  $('#rExportCsv').onclick = async () => {
    const btn = $('#rExportCsv'); const old = btn.textContent; btn.textContent = 'กำลังสร้าง…'; btn.disabled = true;
    try {
      const res = await fetch('/api/games/campaigns/' + c.id + '/report.csv', {
        headers: { authorization: state.token ? 'Bearer ' + state.token : '' },
      });
      if (!res.ok) throw new Error('export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `report-${c.id}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { alert('ดาวน์โหลดไม่สำเร็จ: ' + e.message); }
    finally { btn.textContent = old; btn.disabled = false; }
  };
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:20px">Boot error: ${esc(e.message)}</pre>`; });
