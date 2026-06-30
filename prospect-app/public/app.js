// Prospect Scoring — standalone vanilla SPA (no build step).
const state = { token: localStorage.getItem('prospect_token') || null, tier: '', query: '' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: state.token ? 'Bearer ' + state.token : '', ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'request failed');
  return res.status === 204 ? null : res.json();
}

function logout() { localStorage.removeItem('prospect_token'); state.token = null; showLogin(); }
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); renderProspects($('#main')); }

// ── Login ──────────────────────────────────────────────────────────────────────
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginErr');
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'login failed');
    state.token = j.token; localStorage.setItem('prospect_token', j.token);
    err.classList.add('hidden'); showApp();
  } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); }
});
$('#logoutBtn').addEventListener('click', logout);

// ── Radar + helpers ─────────────────────────────────────────────────────────────
const TIER_META = {
  hot: { label: '🔥 Hot', color: '#da3633' },
  warm: { label: '🌤️ Warm', color: '#d29922' },
  cold: { label: '❄️ Cold', color: '#388bfd' },
};
const tierBadge = (tier) => {
  const m = TIER_META[tier] || TIER_META.cold;
  return `<span class="pill" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}66">${m.label}</span>`;
};
const miniBar = (label, v) =>
  `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)"><span style="width:42px">${label}</span>
    <span class="bartrack" style="flex:1"><span class="barfill" style="width:${v}%;background:var(--accent)"></span></span><span style="width:24px;text-align:right">${v}</span></div>`;

// Zero-dependency SVG radar chart of a lead's scoring axes (0–100 each).
function radarSvg(axes, chart = 150, color = 'var(--accent)') {
  const padX = 62, padY = 30;
  const w = chart + padX * 2, h = chart + padY * 2;
  const cx = w / 2, cy = h / 2, r = chart / 2, n = axes.length;
  const ang = (i) => (Math.PI * 2 * i / n) - Math.PI / 2;
  const pt = (i, rad) => [cx + rad * Math.cos(ang(i)), cy + rad * Math.sin(ang(i))];
  const poly = (rad, mapV) => axes.map((a, i) => pt(i, rad * (mapV ? a.value / 100 : 1)).map((v) => v.toFixed(1)).join(',')).join(' ');
  let grid = '';
  for (let ring = 1; ring <= 4; ring++) grid += `<polygon points="${poly(r * ring / 4)}" fill="none" stroke="var(--border)" stroke-width="1"/>`;
  let spokes = '';
  axes.forEach((a, i) => {
    const [x, y] = pt(i, r);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`;
    const [lx, ly] = pt(i, r + 14);
    const anchor = Math.abs(lx - cx) < 3 ? 'middle' : lx > cx ? 'start' : 'end';
    spokes += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="${anchor}" dominant-baseline="middle">${esc(a.axis)} ${a.value}</text>`;
  });
  const dots = axes.map((a, i) => { const [x, y] = pt(i, r * a.value / 100); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"/>`; }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${grid}${spokes}
    <polygon points="${poly(r, true)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="2"/>${dots}</svg>`;
}

// ── Dashboard ───────────────────────────────────────────────────────────────────
async function renderProspects(main) {
  let data;
  const qs = new URLSearchParams();
  if (state.tier) qs.set('tier', state.tier);
  if (state.query) qs.set('q', state.query);
  try { data = await api('/leads?' + qs.toString()); } catch { return; }
  const s = data.summary, leads = data.leads;
  const stat = (label, value, sub = '') =>
    `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>`;

  main.innerHTML = `<div class="admin">
    <div class="report-toolbar">
      <h2 style="margin:0">🎯 คะแนนความน่าสนใจลูกค้า</h2>
      <div class="report-actions">
        <input id="pSearch" placeholder="ค้นหา ชื่อ/เบอร์/โครงการ" value="${esc(state.query)}" style="min-width:180px" />
        <select id="pTier">
          <option value="">ทุกระดับ</option>
          <option value="hot" ${state.tier === 'hot' ? 'selected' : ''}>🔥 Hot</option>
          <option value="warm" ${state.tier === 'warm' ? 'selected' : ''}>🌤️ Warm</option>
          <option value="cold" ${state.tier === 'cold' ? 'selected' : ''}>❄️ Cold</option>
        </select>
        <label class="btn" style="cursor:pointer">⬆️ นำเข้าไฟล์ (xlsx/csv)<input type="file" id="pFile" accept=".xlsx,.csv" hidden /></label>
        <button class="btn ghost" id="pExport">⬇️ Export CSV</button>
        ${s.total ? '<button class="btn ghost" id="pClear">ล้างข้อมูล</button>' : ''}
      </div>
    </div>
    <p class="muted" style="font-size:12px;margin-top:-4px">
      ให้คะแนน 0–100 จาก <b>Intent</b> (ความพร้อมซื้อ) + <b>Fit</b> (ตรงกลุ่มเป้าหมาย) — อ่านโน้ตการเข้าชมมาวิเคราะห์ด้วย · คำนวณในเครื่อง ไม่ต้องต่อ LLM
    </p>

    ${s.total ? `<div class="stat-grid">
      ${stat('ลูกค้าทั้งหมด', s.total)}
      ${stat('🔥 Hot', s.tierCounts.hot, 'ควรปิดด่วน')}
      ${stat('🌤️ Warm', s.tierCounts.warm)}
      ${stat('❄️ Cold', s.tierCounts.cold)}
      ${stat('คะแนนเฉลี่ย', s.avgScore)}
      ${stat('ปิดการขายแล้ว', s.converted)}
    </div>` : ''}

    ${!s.total ? `<div class="card" style="text-align:center;padding:40px">
      <div style="font-size:42px">📥</div><h3>ยังไม่มีข้อมูลลูกค้า</h3>
      <p class="muted">นำเข้าไฟล์รายงาน (เช่น CoSale Visit & Revisit Report .xlsx หรือ .csv) เพื่อให้ระบบจัดอันดับ prospect ที่น่าสนใจที่สุด</p>
    </div>` : `
    ${s.projects.length > 1 ? `<div class="card">
      <h3>คะแนนเฉลี่ยตามโครงการ</h3>
      <table><thead><tr><th>โครงการ</th><th>ลูกค้า</th><th>🔥 Hot</th><th>ปิดได้</th><th>คะแนนเฉลี่ย</th></tr></thead>
      <tbody>${s.projects.map((p) => `<tr><td>${esc(p.project)}</td><td>${p.leads}</td><td>${p.hot}</td><td>${p.converted}</td>
        <td><b style="color:${p.avgScore >= 70 ? TIER_META.hot.color : p.avgScore >= 45 ? TIER_META.warm.color : TIER_META.cold.color}">${p.avgScore}</b></td></tr>`).join('')}</tbody></table>
    </div>` : ''}
    <div class="card">
      <h3>อันดับลูกค้าน่าสนใจ (${leads.length})</h3>
      <table class="prospect-table"><thead><tr><th>#</th><th>ลูกค้า</th><th>โครงการ</th><th>คะแนน</th><th>เกรด/สถานะ</th><th>งบ/รายได้</th><th>สัญญาณ</th><th>เซลส์</th></tr></thead>
      <tbody>${leads.map((l, i) => prospectRow(l, i)).join('')}</tbody></table>
    </div>`}
  </div>`;

  $('#pTier').onchange = () => { state.tier = $('#pTier').value; renderProspects(main); };
  let t;
  $('#pSearch').oninput = () => { clearTimeout(t); t = setTimeout(() => { state.query = $('#pSearch').value.trim(); renderProspects(main); }, 300); };
  $('#pFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const label = main.querySelector('label.btn'); const prev = label.innerHTML; label.innerHTML = '⏳ กำลังวิเคราะห์…';
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + state.token, 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
        body: await file.arrayBuffer(),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'import failed');
      alert(`✓ นำเข้าสำเร็จ ${out.imported} ราย (ใหม่ ${out.created} · อัปเดต ${out.updated})\n🔥 Hot ${out.tierCounts.hot} · 🌤️ Warm ${out.tierCounts.warm} · ❄️ Cold ${out.tierCounts.cold}`);
      renderProspects(main);
    } catch (err) { alert('✕ ' + err.message); label.innerHTML = prev; }
  };
  if ($('#pExport')) $('#pExport').onclick = async () => {
    const res = await fetch('/api/leads/export' + (state.tier ? '?tier=' + state.tier : ''), { headers: { authorization: 'Bearer ' + state.token } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = 'prospects.csv'; a.click();
  };
  if ($('#pClear')) $('#pClear').onclick = async () => { if (confirm('ลบข้อมูลลูกค้าที่นำเข้าทั้งหมด?')) { await api('/leads', { method: 'DELETE' }); renderProspects(main); } };
  main.querySelectorAll('.prospect-table tbody tr[data-id]').forEach((tr) => { tr.onclick = () => toggleProspectDetail(tr); });
}

function prospectRow(l, i) {
  const decision = l.signals?.decisionBucket && l.signals.decisionBucket !== 'unknown' ? l.signals.decisionBucket : '';
  const sig = [];
  if (l.revisit) sig.push('<span class="chip">🔁 ดูซ้ำ</span>');
  if (l.signals?.interested) sig.push('<span class="chip">สนใจ</span>');
  if (l.signals?.comparing) sig.push('<span class="chip">เทียบโครงการ</span>');
  if (l.signals?.loanReady) sig.push('<span class="chip">สินเชื่อพร้อม</span>');
  if (l.signals?.loanConcern) sig.push('<span class="chip" style="color:#da3633">⚠ ติดกู้</span>');
  if (decision) sig.push(`<span class="chip">⏱ ${esc(decision)}</span>`);
  return `<tr data-id="${l.id}" style="cursor:pointer">
    <td>${i + 1}</td>
    <td><b>${esc(l.customerName || '—')}</b>${l.converted ? ' <span class="chip" style="color:#1a7f37">✓ ปิดได้</span>' : ''}<div class="muted" style="font-size:11px">${esc(l.mobile || '')}</div></td>
    <td>${esc(l.project || '—')}</td>
    <td><div style="display:flex;align-items:center;gap:8px"><b style="font-size:18px">${l.score}</b>${tierBadge(l.tier)}</div>
      <div style="margin-top:3px;min-width:130px">${miniBar('intent', l.intent)}${miniBar('fit', l.fit)}</div></td>
    <td>${esc(l.grading || '—')}<div class="muted" style="font-size:11px">${esc(l.stage || '')}</div></td>
    <td>${esc(l.budget || '—')}<div class="muted" style="font-size:11px">${esc(l.salary || '')}</div></td>
    <td>${sig.join(' ') || '<span class="muted">—</span>'}</td>
    <td class="muted" style="font-size:12px">${esc(l.owner || '—')}</td>
  </tr>`;
}

async function toggleProspectDetail(tr) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('prospect-detail')) { next.remove(); return; }
  let lead; try { lead = await api('/leads/' + tr.dataset.id); } catch { return; }
  const groups = { intent: 'Intent — ความพร้อมซื้อ', fit: 'Fit — ตรงกลุ่มเป้าหมาย' };
  const factorHtml = (g) => (lead.factors || []).filter((f) => f.group === g).map((f) =>
    `<div class="barrow"><span class="barlbl" title="${esc(f.detail)}">${esc(f.label)}</span>
      <span class="bartrack"><span class="barfill" style="width:${(f.points / f.max) * 100}%"></span></span>
      <span class="barval">${f.points}/${f.max}</span></div>
      <div class="muted" style="font-size:11px;margin:-4px 0 6px 4px">${esc(f.detail)}</div>`).join('');

  const sg = lead.signals || {};
  const insight = [];
  if (sg.decisionBucket && sg.decisionBucket !== 'unknown') insight.push(`⏱ ตัดสินใจ ${esc(sg.decisionBucket)}`);
  if (sg.noteIncome) insight.push(`💰 รายได้จากโน้ต ~${Number(sg.noteIncome).toLocaleString()}`);
  if (sg.interested) insight.push('สนใจ');
  if (sg.comparing) insight.push('เทียบโครงการอื่น');
  if (sg.loanReady) insight.push('สินเชื่อพร้อม');
  if (sg.motivated) insight.push('มีแรงจูงใจ');
  if (sg.detailRich) insight.push('โน้ตละเอียด');
  if (sg.loanConcern) insight.push('⚠ ติดเรื่องกู้');
  if (sg.objection) insight.push('ยังลังเล');

  const detail = document.createElement('tr');
  detail.className = 'prospect-detail';
  detail.innerHTML = `<td colspan="8"><div class="prospect-detail-grid">
      <div class="radar-box">
        <h4 style="margin:4px 0">โปรไฟล์ 8 มิติ</h4>
        ${lead.radar ? radarSvg(lead.radar) : ''}
        <div style="display:flex;gap:10px;justify-content:center;font-size:12px;margin-top:4px">
          <span><b style="color:var(--accent)">Intent</b> ${lead.intent}</span><span><b style="color:var(--accent)">Fit</b> ${lead.fit}</span>
        </div>
      </div>
      <div><h4 style="margin:4px 0">${groups.intent}</h4>${factorHtml('intent')}</div>
      <div><h4 style="margin:4px 0">${groups.fit}</h4>${factorHtml('fit')}</div>
    </div>
    <div style="padding:0 4px 8px">
      <h4 style="margin:6px 0">วิเคราะห์จากโน้ตการเข้าชม</h4>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
        ${insight.length ? insight.map((x) => `<span class="chip">${x}</span>`).join('') : '<span class="muted" style="font-size:12px">ไม่พบสัญญาณชัดเจนในโน้ต</span>'}
      </div>
      ${lead.notes ? `<details><summary class="muted" style="cursor:pointer">อ่านโน้ตเต็ม (Visit notes)</summary>
        <pre style="white-space:pre-wrap;font-size:12px;background:var(--panel);padding:10px;border-radius:8px;max-height:240px;overflow:auto;border:1px solid var(--border)">${esc(lead.notes)}</pre></details>` : ''}
    </div></td>`;
  tr.after(detail);
}

// ── Boot ─────────────────────────────────────────────────────────────────────────
if (state.token) showApp(); else showLogin();
