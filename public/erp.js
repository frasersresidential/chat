// ERP โรงพิมพ์สติกเกอร์ — zero-build vanilla SPA (shares login with the inbox).
const state = {
  token: localStorage.getItem('omnichat_token'),
  boot: null,          // /api/erp/bootstrap payload
  dash: null,
  ws: null,
  refreshTimer: null,
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtB = (n) => n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const fmtN = (n) => Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const dateTH = (iso, withTime = false) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) }); }
  catch { return iso; }
};
const timeAgo = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'เมื่อครู่';
  if (d < 3600) return Math.floor(d / 60) + ' นาที';
  if (d < 86400) return Math.floor(d / 3600) + ' ชม.';
  return Math.floor(d / 86400) + ' วัน';
};

const LAM_LABEL = { none: 'ไม่เคลือบ', gloss: 'เคลือบเงา', matte: 'เคลือบด้าน', uv: 'เคลือบ UV' };
const CUT_LABEL = { none: 'ไม่ตัด (แผ่น/ม้วน)', straight: 'ตัดตรง', diecut: 'ไดคัทตามรูป' };
const TIER_LABEL = { retail: 'ทั่วไป', wholesale: 'ขายส่ง', vip: 'VIP' };
const PAY_LABEL = { unpaid: 'ยังไม่ชำระ', deposit: 'มัดจำแล้ว', paid: 'ชำระครบ' };
const QUOTE_ST = { draft: '📝 ร่าง', sent: '📤 ส่งแล้ว', accepted: '✅ เป็นใบงานแล้ว', rejected: '✕ ไม่เอา' };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token, ...(opts.headers || {}) },
  });
  if (res.status === 401) { location.href = '/'; throw new Error('unauthorized'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'request failed');
  }
  return res.status === 204 ? null : res.json();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  if (!state.token) { location.href = '/'; return; }
  try {
    state.boot = await api('/erp/bootstrap');
  } catch (e) {
    $('#main').innerHTML = `<div class="admin"><h2>🏭 ERP</h2><p class="muted">${esc(e.message)} — บัญชีนี้อาจไม่มีสิทธิ์ใช้งาน ERP</p></div>`;
    return;
  }
  $('#meName').textContent = state.boot.me.name;
  $('#nav').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { location.hash = '#' + b.dataset.view; };
  });
  connectWs();
  window.addEventListener('hashchange', route);
  route();
  refreshBadges();
}

function setActiveNav(view) {
  const primary = { dash: 'dash', quotes: 'quotes', 'new-quote': 'quotes', quote: 'quotes', queue: 'queue', order: 'queue', stock: 'stock', customers: 'customers', settings: 'settings' }[view] || view;
  $('#nav').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === primary));
}

function parseHash() {
  const h = location.hash.replace(/^#/, '') || 'dash';
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { parts, query };
}

async function route() {
  const { parts, query } = parseHash();
  const main = $('#main');
  const view = parts[0] || 'dash';
  setActiveNav(view);
  try {
    if (view === 'dash') return await renderDash(main);
    if (view === 'quotes') return await renderQuotes(main);
    if (view === 'new-quote') return await renderCalculator(main, query);
    if (view === 'quote') return await renderQuoteDetail(main, parts[1]);
    if (view === 'queue') return await renderQueue(main);
    if (view === 'order') return await renderOrder(main, parts[1]);
    if (view === 'stock') return await renderStock(main);
    if (view === 'customers') return await renderCustomers(main, query);
    if (view === 'settings') return await renderSettings(main);
    if (view === 'print') return await renderPrint(main, parts[1], parts[2]);
    return await renderDash(main);
  } catch (e) {
    main.innerHTML = `<div class="admin"><p class="muted">✕ ${esc(e.message)}</p></div>`;
  }
}

// ── Realtime: any ERP change refreshes the current screen (throttled) ────────
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'erp:changed') return;
    const view = parseHash().parts[0] || 'dash';
    if (view === 'new-quote' || view === 'print' || view === 'settings') return; // don't clobber forms
    if (state.refreshTimer) return;
    state.refreshTimer = setTimeout(() => { state.refreshTimer = null; route(); refreshBadges(); }, 900);
  };
  ws.onclose = () => setTimeout(connectWs, 4000);
}

async function refreshBadges() {
  try {
    const d = await api('/erp/dashboard');
    state.dash = d;
    const qb = $('#queueBadge'); qb.textContent = d.activeJobs; qb.classList.toggle('hidden', !d.activeJobs);
    const sb = $('#stockBadge'); sb.textContent = d.lowStock.length; sb.classList.toggle('hidden', !d.lowStock.length);
  } catch { /* ignore */ }
}

const custName = (id) => state.boot.customers.find((c) => c.id === id)?.name || '—';
const stChip = (s) => `<span class="st st-${s}">${esc(state.boot.orderStatusLabels[s] || s)}</span>`;
const payChip = (s) => `<span class="pay-chip pay-${s}">${PAY_LABEL[s] || s}</span>`;
const dueCell = (o) => {
  if (!o.dueDate) return '<span class="muted">—</span>';
  const days = Math.ceil((new Date(o.dueDate) - Date.now()) / 86400000);
  const cls = days < 0 ? 'due-late' : days <= 1 ? 'due-soon' : '';
  return `<span class="${cls}">${dateTH(o.dueDate)}${days < 0 ? ' ⚠️ เลยกำหนด' : days <= 1 ? ' 🔥' : ''}</span>`;
};

// ── Dashboard ────────────────────────────────────────────────────────────────
async function renderDash(main) {
  const d = await api('/erp/dashboard');
  state.dash = d;
  const stat = (label, value, sub = '') =>
    `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>`;
  const labels = state.boot.orderStatusLabels;
  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">🏭 แดชบอร์ดโรงงาน</h2>
      <div style="display:flex;gap:8px">
        <button class="btn" id="dNewQuote">🧾 ตีราคา / ใบเสนอราคาใหม่</button>
      </div>
    </div>
    <div class="stat-grid">
      ${stat('ยอดรับเงินวันนี้', fmtB(d.salesToday))}
      ${stat('ยอดรับเงินเดือนนี้', fmtB(d.salesMonth))}
      ${stat('งานที่กำลังทำ', fmtN(d.activeJobs))}
      ${stat('ยอดค้างชำระ', fmtB(d.unpaidTotal))}
      ${stat('วัสดุใกล้หมด', d.lowStock.length, d.lowStock.length ? '⚠️ ควรสั่งซื้อ' : '✓ ปกติ')}
    </div>
    <div class="report-cols">
      <div class="card">
        <h3 style="margin-top:0">📋 งานในแต่ละขั้น</h3>
        ${state.boot.orderStatuses.filter((s) => s !== 'cancelled').map((s) => {
          const n = d.byStatus[s] || 0;
          const max = Math.max(1, ...Object.values(d.byStatus));
          return `<div class="barrow"><span class="barlbl">${esc(labels[s])}</span>
            <span class="bartrack"><span class="barfill" style="width:${(n / max) * 100}%"></span></span>
            <span class="barval">${n}</span></div>`;
        }).join('')}
      </div>
      <div class="card">
        <h3 style="margin-top:0">⏰ งานใกล้ถึงกำหนดส่ง</h3>
        ${d.dueSoon.length ? `<table class="mini-table"><tbody>${d.dueSoon.map((o) => `
          <tr class="clickable" onclick="location.hash='#order/${o.id}'">
            <td><b>${esc(o.number)}</b><div class="muted" style="font-size:11px">${esc(o.customerName)}</div></td>
            <td>${stChip(o.status)}</td><td>${dueCell(o)}</td>
          </tr>`).join('')}</tbody></table>` : '<p class="muted">ไม่มีงานเร่ง 🎉</p>'}
        <h3>📉 วัสดุใกล้หมด</h3>
        ${d.lowStock.length ? `<table class="mini-table"><tbody>${d.lowStock.map((m) => `
          <tr><td>${esc(m.name)}</td><td class="num"><b class="due-late">${fmtN(m.stockQty)}</b> / จุดสั่งซื้อ ${fmtN(m.reorderPoint)}</td></tr>`).join('')}</tbody></table>
          <button class="btn ghost" onclick="location.hash='#stock'" style="margin-top:8px">ไปหน้าสต๊อก →</button>`
          : '<p class="muted">สต๊อกทุกตัวอยู่เหนือจุดสั่งซื้อ ✓</p>'}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">🧾 ใบเสนอราคาล่าสุด</h3>
      ${d.recentQuotes.length ? `<table><thead><tr><th>เลขที่</th><th>ลูกค้า</th><th class="num">ยอด</th><th>สถานะ</th><th>เมื่อ</th></tr></thead>
        <tbody>${d.recentQuotes.map((q) => `<tr class="clickable" onclick="location.hash='#quote/${q.id}'">
          <td><b>${esc(q.number)}</b></td><td>${esc(q.customerName)}</td>
          <td class="num">${fmtB(q.grandTotal)}</td><td>${QUOTE_ST[q.status] || q.status}</td>
          <td class="muted">${timeAgo(q.createdAt)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีใบเสนอราคา — เริ่มจากปุ่ม "ตีราคา" ด้านบน</p>'}
    </div>
  </div>`;
  $('#dNewQuote').onclick = () => { location.hash = '#new-quote'; };
}

// ── Quotes list ──────────────────────────────────────────────────────────────
async function renderQuotes(main) {
  const quotes = await api('/erp/quotes');
  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">🧾 ใบเสนอราคา</h2>
      <button class="btn" onclick="location.hash='#new-quote'">＋ ตีราคาใหม่</button>
    </div>
    <div class="card">
      ${quotes.length ? `<table><thead><tr><th>เลขที่</th><th>ลูกค้า</th><th>รายการ</th><th class="num">ยอดรวม</th><th>สถานะ</th><th>โดย</th><th>เมื่อ</th></tr></thead>
      <tbody>${quotes.map((q) => `<tr class="clickable" onclick="location.hash='#quote/${q.id}'">
        <td><b>${esc(q.number)}</b>${q.conversationId ? ' <span class="chip ads" title="สร้างจากแชต">💬</span>' : ''}</td>
        <td>${esc(q.customerName)} <span class="chip">${TIER_LABEL[q.tier] || q.tier}</span></td>
        <td class="muted" style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(q.items.map((i) => i.desc).join(', '))}</td>
        <td class="num"><b>${fmtB(q.grandTotal)}</b></td>
        <td>${QUOTE_ST[q.status] || q.status}${q.orderNumber ? `<div class="muted" style="font-size:11px">→ ${esc(q.orderNumber)}</div>` : ''}</td>
        <td class="muted">${esc(q.createdByName || '')}</td>
        <td class="muted">${timeAgo(q.createdAt)}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีใบเสนอราคา</p>'}
    </div>
  </div>`;
}

// ── Calculator / new quote ───────────────────────────────────────────────────
let calcItems = [];
let calcCustomerId = null;
let calcConversationId = null;
let calcEditQuoteId = null;

function newCalcItem() {
  const firstMat = state.boot.materials.find((m) => m.unit === 'sqm' && m.active !== false);
  return { materialId: firstMat?.id || '', widthCm: 5, heightCm: 5, qty: 500, laminate: 'none', cutType: 'diecut', dieMode: 'new', dieId: '', calc: null, unitPrice: '' };
}

async function renderCalculator(main, query) {
  calcItems = [newCalcItem()];
  calcCustomerId = query.customer || null;
  calcConversationId = null;
  calcEditQuoteId = query.edit || null;

  if (query.conv) {
    try {
      const r = await api('/erp/customers/from-conversation', { method: 'POST', body: JSON.stringify({ conversationId: query.conv }) });
      if (!state.boot.customers.find((c) => c.id === r.customer.id)) state.boot.customers.push(r.customer);
      calcCustomerId = r.customer.id;
      calcConversationId = r.conversationId;
    } catch { /* continue without link */ }
  }
  if (calcEditQuoteId) {
    const { quote } = await api('/erp/quotes/' + calcEditQuoteId);
    calcCustomerId = quote.customerId;
    calcConversationId = quote.conversationId;
    calcItems = quote.items.map((it) => ({ ...it.spec, dieId: it.dieId || '', calc: null, unitPrice: it.unitPrice }));
  }

  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">🧮 ตีราคา${calcEditQuoteId ? ' (แก้ไขใบเสนอราคา)' : ''}</h2>
      ${calcConversationId ? '<span class="chip project">💬 ผูกกับแชตลูกค้า — สถานะงานจะแจ้งในแชตให้อัตโนมัติ</span>' : ''}
    </div>
    <div class="card">
      <div class="form-grid">
        <div><label>ลูกค้า</label><select id="qCust">
          <option value="">— เลือกลูกค้า —</option>
          ${state.boot.customers.map((c) => `<option value="${c.id}" ${c.id === calcCustomerId ? 'selected' : ''}>${esc(c.name)} (${TIER_LABEL[c.tier]})</option>`).join('')}
        </select></div>
        <div><label>เพิ่มลูกค้าใหม่เร็ว ๆ</label>
          <div style="display:flex;gap:6px"><input id="qNewCust" placeholder="ชื่อลูกค้าใหม่" style="flex:1" /><button class="btn ghost" id="qAddCust">＋</button></div></div>
      </div>
    </div>
    <div id="calcRows"></div>
    <button class="btn ghost" id="qAddItem">＋ เพิ่มรายการ</button>
    <div class="card" style="margin-top:12px">
      <div class="form-grid">
        <div><label>ส่วนลด (฿)</label><input id="qDiscount" type="number" min="0" value="0" /></div>
        <div style="grid-column:span 2"><label>หมายเหตุ</label><input id="qNote" placeholder="เช่น ลูกค้าขอไฟล์ proof ก่อนพิมพ์" /></div>
        <div><label>&nbsp;</label><button class="btn" id="qSave" style="width:100%">${calcEditQuoteId ? '💾 บันทึกการแก้ไข' : '🧾 สร้างใบเสนอราคา'}</button></div>
      </div>
      <div id="qTotal" class="muted" style="margin-top:10px;font-size:15px"></div>
      <div id="qErr" class="muted" style="color:#f1707a;margin-top:6px"></div>
    </div>
  </div>`;

  $('#qCust').onchange = () => { calcCustomerId = $('#qCust').value || null; recalcAll(); };
  $('#qAddCust').onclick = async () => {
    const name = $('#qNewCust').value.trim();
    if (!name) return;
    try {
      const c = await api('/erp/customers', { method: 'POST', body: JSON.stringify({ name }) });
      state.boot.customers.push(c);
      calcCustomerId = c.id;
      const sel = $('#qCust');
      sel.insertAdjacentHTML('beforeend', `<option value="${c.id}" selected>${esc(c.name)} (${TIER_LABEL[c.tier]})</option>`);
      sel.value = c.id;
      $('#qNewCust').value = '';
      recalcAll();
    } catch (e) { alert(e.message); }
  };
  $('#qAddItem').onclick = () => { calcItems.push(newCalcItem()); renderCalcRows(); };
  $('#qSave').onclick = saveQuote;
  renderCalcRows();
  recalcAll();
}

function renderCalcRows() {
  const mats = state.boot.materials.filter((m) => m.unit === 'sqm' && m.active !== false);
  const cust = state.boot.customers.find((c) => c.id === calcCustomerId);
  const dies = cust ? state.boot.dies.filter((d) => d.customerId === cust.id) : [];
  $('#calcRows').innerHTML = calcItems.map((it, i) => `
    <div class="calc-item" data-i="${i}">
      <div class="calc-grid">
        <div style="grid-column:span 2"><label>วัสดุ</label><select data-f="materialId">
          ${mats.map((m) => `<option value="${m.id}" ${m.id === it.materialId ? 'selected' : ''}>${esc(m.name)} (${fmtB(m.costPerUnit)}/ตร.ม.)</option>`).join('')}
        </select></div>
        <div><label>กว้าง (ซม.)</label><input data-f="widthCm" type="number" min="0.5" step="0.5" value="${it.widthCm}" /></div>
        <div><label>สูง (ซม.)</label><input data-f="heightCm" type="number" min="0.5" step="0.5" value="${it.heightCm}" /></div>
        <div><label>จำนวน (ชิ้น)</label><input data-f="qty" type="number" min="1" value="${it.qty}" /></div>
        <div><label>เคลือบ</label><select data-f="laminate">
          ${Object.entries(LAM_LABEL).map(([k, v]) => `<option value="${k}" ${k === it.laminate ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        <div><label>การตัด</label><select data-f="cutType">
          ${Object.entries(CUT_LABEL).map(([k, v]) => `<option value="${k}" ${k === it.cutType ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        ${it.cutType === 'diecut' ? `<div><label>บล็อกไดคัท</label><select data-f="dieMode">
          <option value="new" ${it.dieMode !== 'existing' ? 'selected' : ''}>ทำบล็อกใหม่ (+ค่าบล็อก)</option>
          <option value="existing" ${it.dieMode === 'existing' ? 'selected' : ''}>ใช้บล็อกเดิม</option>
        </select></div>` : ''}
        ${it.cutType === 'diecut' && it.dieMode === 'existing' ? `<div><label>เลือกบล็อกของลูกค้า</label><select data-f="dieId">
          <option value="">— ระบุทีหลัง —</option>
          ${dies.map((d) => `<option value="${d.id}" ${d.id === it.dieId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select></div>` : ''}
        <div><label>ราคาต่อชิ้น (แก้ได้)</label><input data-f="unitPrice" type="number" min="0" step="0.01" value="${it.unitPrice ?? ''}" placeholder="อัตโนมัติ" /></div>
        <div><button class="btn ghost" data-rm="${i}" title="ลบรายการ">🗑</button></div>
      </div>
      <div class="calc-break" id="break-${i}"><span class="muted">กำลังคำนวณ…</span></div>
    </div>`).join('');

  $('#calcRows').querySelectorAll('.calc-item').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll('[data-f]').forEach((inp) => {
      inp.onchange = () => {
        const f = inp.dataset.f;
        calcItems[i][f] = ['widthCm', 'heightCm', 'qty'].includes(f) ? Number(inp.value) : inp.value;
        if (f === 'cutType' || f === 'dieMode') renderCalcRows();
        recalcItem(i);
      };
    });
    row.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      calcItems.splice(Number(b.dataset.rm), 1);
      if (!calcItems.length) calcItems = [newCalcItem()];
      renderCalcRows(); recalcAll();
    });
  });
  calcItems.forEach((_, i) => recalcItem(i));
}

async function recalcItem(i) {
  const it = calcItems[i];
  const box = $('#break-' + i);
  if (!box) return;
  const cust = state.boot.customers.find((c) => c.id === calcCustomerId);
  try {
    const r = await api('/erp/calc', { method: 'POST', body: JSON.stringify({ spec: it, tier: cust?.tier || 'retail' }) });
    it.calc = r;
    const price = it.unitPrice ? Number(it.unitPrice) * it.qty : r.amount;
    box.innerHTML = `
      <span class="chip">พิมพ์ ${fmtN(r.printedSqm)} ตร.ม.</span>
      <span class="chip">ใช้วัสดุ ${fmtN(r.usedSqm)} ตร.ม. (รวมเผื่อเสีย)</span>
      <span class="chip">ต้นทุน ${fmtB(r.cost.total)}</span>
      ${r.cost.dieSetup ? `<span class="chip">ค่าบล็อก ${fmtB(r.cost.dieSetup)}</span>` : ''}
      <span class="chip owner">กำไร ~${fmtB(price - r.cost.total)}</span>
      <span class="calc-price">${fmtB(price)} <span class="muted" style="font-size:12px;font-weight:400">(${fmtB(price / it.qty)}/ชิ้น)</span></span>`;
    updateTotal();
  } catch (e) {
    it.calc = null;
    box.innerHTML = `<span class="muted" style="color:#f1707a">✕ ${esc(e.message)}</span>`;
    updateTotal();
  }
}
function recalcAll() { calcItems.forEach((_, i) => recalcItem(i)); }

function updateTotal() {
  const box = $('#qTotal');
  if (!box) return;
  const discount = Number($('#qDiscount')?.value || 0);
  const sum = calcItems.reduce((s, it) => {
    if (!it.calc) return s;
    return s + (it.unitPrice ? Number(it.unitPrice) * it.qty : it.calc.amount);
  }, 0);
  const s = state.boot.settings;
  const after = Math.max(0, sum - discount);
  const vat = s.vat.enabled ? after * (s.vat.rate / 100) : 0;
  box.innerHTML = `รวม <b>${fmtB(sum)}</b>${discount ? ` − ส่วนลด ${fmtB(discount)}` : ''}` +
    (s.vat.enabled ? ` + VAT ${s.vat.rate}% = <b style="color:var(--green)">${fmtB(after + vat)}</b>` : ` = <b style="color:var(--green)">${fmtB(after)}</b>`);
}

async function saveQuote() {
  $('#qErr').textContent = '';
  if (!calcCustomerId) { $('#qErr').textContent = 'เลือกลูกค้าก่อนค่ะ'; return; }
  const items = calcItems.map((it) => ({
    spec: { materialId: it.materialId, widthCm: it.widthCm, heightCm: it.heightCm, qty: it.qty, laminate: it.laminate, cutType: it.cutType, dieMode: it.dieMode },
    dieId: it.dieId || null,
    ...(it.unitPrice ? { unitPrice: Number(it.unitPrice) } : {}),
  }));
  const body = { customerId: calcCustomerId, conversationId: calcConversationId, items, discount: Number($('#qDiscount').value || 0), note: $('#qNote').value };
  try {
    const q = calcEditQuoteId
      ? await api('/erp/quotes/' + calcEditQuoteId, { method: 'PUT', body: JSON.stringify(body) })
      : await api('/erp/quotes', { method: 'POST', body: JSON.stringify(body) });
    location.hash = '#quote/' + q.id;
  } catch (e) { $('#qErr').textContent = '✕ ' + e.message; }
}

// ── Quote detail ─────────────────────────────────────────────────────────────
async function renderQuoteDetail(main, id) {
  const { quote: q, customer } = await api('/erp/quotes/' + id);
  const editable = ['draft', 'sent'].includes(q.status);
  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">🧾 ${esc(q.number)} <span style="font-size:14px">${QUOTE_ST[q.status] || q.status}</span></h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn ghost" onclick="location.hash='#print/quote/${q.id}'">🖨 พิมพ์</button>
        <button class="btn ghost" id="qdCopy">📋 คัดลอกสรุปราคา</button>
        ${editable ? `<button class="btn ghost" onclick="location.hash='#new-quote?edit=${q.id}'">✏️ แก้ไข</button>` : ''}
        ${q.status === 'draft' ? '<button class="btn ghost" id="qdSent">📤 ทำเครื่องหมายส่งแล้ว</button>' : ''}
        ${editable ? '<button class="btn" id="qdConvert">✅ ลูกค้าตกลง → สร้างใบงาน</button>' : ''}
        ${q.orderId ? `<button class="btn" onclick="location.hash='#order/${q.orderId}'">→ ใบงาน ${esc(q.orderNumber)}</button>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="form-grid" style="margin-bottom:8px">
        <div><label>ลูกค้า</label><div><b>${esc(q.customerName)}</b> <span class="chip">${TIER_LABEL[q.tier]}</span>${customer?.phone ? ` <span class="muted">${esc(customer.phone)}</span>` : ''}</div></div>
        <div><label>ใช้ได้ถึง</label><div>${dateTH(q.validUntil)}</div></div>
        <div><label>ผู้เสนอ</label><div>${esc(q.createdByName || '—')}</div></div>
      </div>
      <table><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ตร.ม.</th><th class="num">ราคา/ชิ้น</th><th class="num">รวม</th></tr></thead>
      <tbody>${q.items.map((it) => `<tr>
        <td>${esc(it.desc)}<div class="muted" style="font-size:11px">${esc(it.spec.materialName)} · ${LAM_LABEL[it.spec.laminate]} · ${CUT_LABEL[it.spec.cutType]}${it.spec.dieMode === 'existing' ? ' (บล็อกเดิม)' : it.spec.dieMode === 'new' ? ' (บล็อกใหม่)' : ''}</div></td>
        <td class="num">${fmtN(it.spec.qty)}</td><td class="num">${fmtN(it.printedSqm)}</td>
        <td class="num">${fmtB(it.unitPrice)}</td><td class="num"><b>${fmtB(it.amount)}</b></td>
      </tr>`).join('')}</tbody></table>
      <div style="display:flex;justify-content:flex-end"><table style="width:300px"><tbody>
        <tr><td>รวม</td><td class="num">${fmtB(q.subTotal)}</td></tr>
        ${q.discount ? `<tr><td>ส่วนลด</td><td class="num">−${fmtB(q.discount)}</td></tr>` : ''}
        ${q.vat?.enabled ? `<tr><td>VAT ${q.vat.rate}%</td><td class="num">${fmtB(q.vat.amount)}</td></tr>` : ''}
        <tr><td><b>ยอดสุทธิ</b></td><td class="num"><b style="color:var(--green);font-size:16px">${fmtB(q.grandTotal)}</b></td></tr>
      </tbody></table></div>
      ${q.note ? `<p class="muted">📝 ${esc(q.note)}</p>` : ''}
    </div>
  </div>`;
  $('#qdCopy').onclick = () => {
    const lines = [`ใบเสนอราคา ${q.number}`,
      ...q.items.map((it) => `• ${it.desc} × ${fmtN(it.spec.qty)} ชิ้น = ${fmtB(it.amount)} (${fmtB(it.unitPrice)}/ชิ้น)`),
      q.discount ? `ส่วนลด −${fmtB(q.discount)}` : null,
      q.vat?.enabled ? `VAT ${q.vat.rate}% ${fmtB(q.vat.amount)}` : null,
      `รวมสุทธิ ${fmtB(q.grandTotal)}`,
      `(ราคานี้ยืนถึง ${dateTH(q.validUntil)})`].filter(Boolean);
    navigator.clipboard?.writeText(lines.join('\n'));
    $('#qdCopy').textContent = '✓ คัดลอกแล้ว — วางในแชตได้เลย';
    setTimeout(() => { $('#qdCopy').textContent = '📋 คัดลอกสรุปราคา'; }, 1800);
  };
  if ($('#qdSent')) $('#qdSent').onclick = async () => {
    await api('/erp/quotes/' + q.id, { method: 'PUT', body: JSON.stringify({ status: 'sent' }) });
    renderQuoteDetail(main, q.id);
  };
  if ($('#qdConvert')) $('#qdConvert').onclick = async () => {
    const due = prompt('กำหนดส่งงาน (YYYY-MM-DD) — เว้นว่างได้', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
    if (due === null) return;
    try {
      const order = await api(`/erp/quotes/${q.id}/convert`, { method: 'POST', body: JSON.stringify({ dueDate: due ? new Date(due + 'T17:00:00').toISOString() : null }) });
      location.hash = '#order/' + order.id;
    } catch (e) { alert(e.message); }
  };
}

// ── Production queue (Kanban) ────────────────────────────────────────────────
async function renderQueue(main) {
  const orders = await api('/erp/orders');
  const labels = state.boot.orderStatusLabels;
  const cols = state.boot.orderStatuses.filter((s) => s !== 'cancelled');
  const byStatus = Object.fromEntries(cols.map((s) => [s, []]));
  for (const o of orders) if (byStatus[o.status]) byStatus[o.status].push(o);
  byStatus.done = (byStatus.done || []).slice(0, 12);

  main.innerHTML = `<div class="erp-queue">
    ${cols.map((s) => `
      <div class="kcol">
        <div class="kcol-head">${esc(labels[s])} <span class="kcount">${byStatus[s].length}</span></div>
        <div class="kcol-body" data-status="${s}">
          ${byStatus[s].map((o) => `
            <div class="kcard" draggable="true" data-id="${o.id}">
              <div class="kcard-top"><span class="kcard-name">${esc(o.number)}</span>${o.priority === 'rush' ? '🔥' : ''}</div>
              <div class="kcard-sub">${esc(o.customerName)}</div>
              <div class="kcard-meta">
                <span class="chip">${fmtB(o.grandTotal)}</span>
                ${payChip(o.paymentStatus)}
                ${o.conversationId && o.notifyCustomer ? '<span class="chip ads" title="แจ้งลูกค้าในแชตอัตโนมัติ">💬</span>' : ''}
              </div>
              <div style="font-size:11px;margin-top:4px">${dueCell(o)}</div>
            </div>`).join('')}
        </div>
      </div>`).join('')}
  </div>`;

  main.querySelectorAll('.kcard').forEach((card) => {
    card.onclick = () => { location.hash = '#order/' + card.dataset.id; };
    card.ondragstart = (e) => { e.dataTransfer.setData('text/id', card.dataset.id); card.classList.add('dragging'); };
    card.ondragend = () => card.classList.remove('dragging');
  });
  main.querySelectorAll('.kcol-body').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/id');
      try { await api(`/erp/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status: col.dataset.status }) }); }
      catch (err) { alert(err.message); }
      renderQueue(main); refreshBadges();
    };
  });
}

// ── Order (job) detail ───────────────────────────────────────────────────────
async function renderOrder(main, id) {
  const { order: o, customer, docs } = await api('/erp/orders/' + id);
  const labels = state.boot.orderStatusLabels;
  const statuses = state.boot.orderStatuses;
  const idx = statuses.indexOf(o.status);
  const next = idx >= 0 && idx < statuses.indexOf('done') ? statuses[idx + 1] : null;
  const remain = Math.max(0, (o.grandTotal || 0) - (o.paidAmount || 0));

  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">📋 ${esc(o.number)} ${stChip(o.status)} ${payChip(o.paymentStatus)} ${o.priority === 'rush' ? '<span class="chip sla-breach">🔥 งานด่วน</span>' : ''}</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn ghost" onclick="location.hash='#print/job/${o.id}'">🖨 ใบงานให้ช่าง</button>
        <button class="btn ghost" id="odInvoice">🧾 ใบแจ้งหนี้</button>
        <button class="btn ghost" id="odReceipt">🧾 ใบเสร็จ</button>
        ${o.conversationId ? `<a class="btn ghost" href="/#conv/${o.conversationId}">💬 เปิดแชตลูกค้า</a>` : ''}
      </div>
    </div>
    <div class="job-cols">
      <div>
        <div class="card">
          <h3 style="margin-top:0">รายการผลิต — ${esc(o.customerName)} <span class="chip">${TIER_LABEL[o.tier]}</span>${customer?.phone ? ` <span class="muted" style="font-size:12px">${esc(customer.phone)}</span>` : ''}</h3>
          <table><thead><tr><th>งาน</th><th class="num">จำนวน</th><th class="num">ตร.ม.ใช้</th><th class="num">รวม</th></tr></thead>
          <tbody>${o.items.map((it) => `<tr>
            <td>${esc(it.desc)}<div class="muted" style="font-size:11px">${esc(it.spec.materialName)} · ${it.spec.widthCm}×${it.spec.heightCm} ซม. · ${LAM_LABEL[it.spec.laminate]} · ${CUT_LABEL[it.spec.cutType]}</div></td>
            <td class="num">${fmtN(it.spec.qty)}</td><td class="num">${fmtN(it.usedSqm)}</td><td class="num"><b>${fmtB(it.amount)}</b></td>
          </tr>`).join('')}</tbody></table>
          <div style="display:flex;justify-content:flex-end"><table style="width:320px"><tbody>
            ${o.discount ? `<tr><td>ส่วนลด</td><td class="num">−${fmtB(o.discount)}</td></tr>` : ''}
            ${o.vat?.enabled ? `<tr><td>VAT ${o.vat.rate}%</td><td class="num">${fmtB(o.vat.amount)}</td></tr>` : ''}
            <tr><td><b>ยอดรวม</b></td><td class="num"><b>${fmtB(o.grandTotal)}</b></td></tr>
            <tr><td>ชำระแล้ว</td><td class="num" style="color:var(--green)">${fmtB(o.paidAmount)}</td></tr>
            <tr><td><b>คงเหลือ</b></td><td class="num"><b style="color:${remain > 0 ? '#f1707a' : 'var(--green)'}">${fmtB(remain)}</b></td></tr>
          </tbody></table></div>
          ${o.stockConsumedAt ? `<p class="muted" style="font-size:12px">✂️ ตัดสต๊อกวัสดุแล้วเมื่อ ${dateTH(o.stockConsumedAt, true)}</p>` : '<p class="muted" style="font-size:12px">ยังไม่ตัดสต๊อก (จะตัดอัตโนมัติเมื่อเข้าคิวผลิต)</p>'}
        </div>
        <div class="card">
          <h3 style="margin-top:0">💰 การชำระเงิน</h3>
          ${o.payments.length ? `<table class="mini-table"><tbody>${o.payments.map((p) => `
            <tr><td>${dateTH(p.at, true)}</td><td>${esc(p.method)}</td><td class="muted">${esc(p.note || '')}</td><td class="num"><b>${fmtB(p.amount)}</b></td><td class="muted">${esc(p.by)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">ยังไม่มีการชำระ</p>'}
          <div class="inline-form">
            <div><label class="muted" style="font-size:11px">ยอด (฿)</label><input id="payAmt" type="number" min="1" value="${remain || ''}" style="width:120px" /></div>
            <div><label class="muted" style="font-size:11px">ช่องทาง</label><select id="payMethod" style="width:110px"><option>โอน</option><option>เงินสด</option><option>บัตร</option><option>PromptPay</option></select></div>
            <div><label class="muted" style="font-size:11px">โน้ต</label><input id="payNote" placeholder="เช่น มัดจำ 50%" style="width:160px" /></div>
            <button class="btn" id="payAdd">＋ บันทึกรับเงิน</button>
          </div>
          ${docs.length ? `<p class="muted" style="font-size:12px;margin-bottom:0">เอกสาร: ${docs.map((d) => `<a href="#print/doc/${d.id}" style="color:var(--accent)">${esc(d.number)}</a>`).join(' · ')}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="card">
          <h3 style="margin-top:0">สถานะงาน</h3>
          <div class="status-btns">
            ${next ? `<button class="btn" id="stNext">→ ${esc(labels[next])}</button>` : ''}
            <select id="stSel">${statuses.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${esc(labels[s])}</option>`).join('')}</select>
            <button class="btn ghost" id="stApply">เปลี่ยน</button>
          </div>
          <label style="display:inline-flex;gap:6px;align-items:center;font-size:12px;margin-top:10px">
            <input type="checkbox" id="odNotify" ${o.notifyCustomer ? 'checked' : ''} ${o.conversationId ? '' : 'disabled'} />
            💬 แจ้งสถานะให้ลูกค้าในแชตอัตโนมัติ${o.conversationId ? '' : ' (ยังไม่ผูกแชต)'}
          </label>
          <div class="form-grid" style="margin-top:10px">
            <div><label>กำหนดส่ง</label><input id="odDue" type="date" value="${o.dueDate ? o.dueDate.slice(0, 10) : ''}" /></div>
            <div><label>ความเร่ง</label><select id="odPrio"><option value="normal" ${o.priority !== 'rush' ? 'selected' : ''}>ปกติ</option><option value="rush" ${o.priority === 'rush' ? 'selected' : ''}>🔥 ด่วน</option></select></div>
          </div>
          <h3>🚚 จัดส่ง</h3>
          <div class="form-grid">
            <div><label>ขนส่ง</label><input id="odShipMethod" value="${esc(o.shipping?.method || '')}" placeholder="Kerry / Flash / EMS" /></div>
            <div><label>เลขพัสดุ</label><input id="odTracking" value="${esc(o.shipping?.trackingNo || '')}" /></div>
            <div style="grid-column:1/-1"><label>ที่อยู่จัดส่ง</label><input id="odAddr" value="${esc(o.shipping?.address || '')}" /></div>
          </div>
          <button class="btn ghost" id="odSave" style="margin-top:10px;width:100%">💾 บันทึกข้อมูลงาน</button>
        </div>
        <div class="card">
          <h3 style="margin-top:0">ไทม์ไลน์</h3>
          <div class="tl">${[...o.timeline].reverse().map((t) => `
            <div class="tl-item"><b>${esc(labels[t.to] || t.to)}</b> · ${esc(t.by)} · ${dateTH(t.at, true)}${t.note ? `<div>📝 ${esc(t.note)}</div>` : ''}</div>`).join('')}</div>
        </div>
      </div>
    </div>
  </div>`;

  const changeStatus = async (status) => {
    try { await api(`/erp/orders/${o.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); }
    catch (e) { return alert(e.message); }
    renderOrder(main, o.id); refreshBadges();
  };
  if ($('#stNext')) $('#stNext').onclick = () => changeStatus(next);
  $('#stApply').onclick = () => changeStatus($('#stSel').value);
  $('#odSave').onclick = async () => {
    try {
      await api('/erp/orders/' + o.id, { method: 'PUT', body: JSON.stringify({
        dueDate: $('#odDue').value ? new Date($('#odDue').value + 'T17:00:00').toISOString() : null,
        priority: $('#odPrio').value,
        notifyCustomer: $('#odNotify').checked,
        shipping: { method: $('#odShipMethod').value, trackingNo: $('#odTracking').value, address: $('#odAddr').value },
      }) });
      renderOrder(main, o.id);
    } catch (e) { alert(e.message); }
  };
  $('#odNotify').onchange = () =>
    api('/erp/orders/' + o.id, { method: 'PUT', body: JSON.stringify({ notifyCustomer: $('#odNotify').checked }) }).catch((e) => alert(e.message));
  $('#payAdd').onclick = async () => {
    try {
      await api(`/erp/orders/${o.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: Number($('#payAmt').value), method: $('#payMethod').value, note: $('#payNote').value }) });
      renderOrder(main, o.id);
    } catch (e) { alert(e.message); }
  };
  const issue = (type) => async () => {
    try {
      const d = await api(`/erp/orders/${o.id}/docs`, { method: 'POST', body: JSON.stringify({ type }) });
      location.hash = '#print/doc/' + d.id;
    } catch (e) { alert(e.message); }
  };
  $('#odInvoice').onclick = issue('invoice');
  $('#odReceipt').onclick = issue('receipt');
}

// ── Stock ────────────────────────────────────────────────────────────────────
let stockFormFor = null; // { materialId, mode: 'in'|'adjust'|'edit' }
async function renderStock(main) {
  const [bootRefresh, moves] = await Promise.all([api('/erp/bootstrap'), api('/erp/stock/moves?limit=60')]);
  state.boot = bootRefresh;
  const manage = state.boot.canManage;
  const CAT_LABEL = { sticker: 'สติกเกอร์', laminate: 'ลามิเนต', ink: 'หมึก', core: 'แกน', packaging: 'แพ็คกิ้ง', other: 'อื่น ๆ' };
  const unitLabel = (u) => ({ sqm: 'ตร.ม.', pcs: 'ชิ้น', roll: 'ม้วน', liter: 'ลิตร' }[u] || u);

  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar">
      <h2 style="margin:0">📦 สต๊อกวัตถุดิบ</h2>
      ${manage ? '<button class="btn" id="mNew">＋ วัสดุใหม่</button>' : ''}
    </div>
    <div class="card" style="overflow-x:auto">
      <table><thead><tr><th>รหัส</th><th>วัสดุ</th><th>หมวด</th><th class="num">คงเหลือ</th><th class="num">≈ ม้วน</th><th class="num">จุดสั่งซื้อ</th><th class="num">ทุน/หน่วย</th><th>ผู้ขาย</th><th></th></tr></thead>
      <tbody>${state.boot.materials.map((m) => `
        <tr class="${m.low ? 'low-row' : ''}">
          <td class="muted">${esc(m.sku)}</td>
          <td>${esc(m.name)}${m.low ? ' <span class="chip sla-breach">ใกล้หมด</span>' : ''}${m.active === false ? ' <span class="chip">ปิดใช้</span>' : ''}</td>
          <td class="muted">${CAT_LABEL[m.category] || m.category}</td>
          <td class="num"><b>${fmtN(m.stockQty)}</b> <span class="muted">${unitLabel(m.unit)}</span></td>
          <td class="num muted">${m.rollSqm ? fmtN(m.stockQty / m.rollSqm) : '—'}</td>
          <td class="num muted">${fmtN(m.reorderPoint)}</td>
          <td class="num">${fmtB(m.costPerUnit)}</td>
          <td class="muted">${esc(m.supplier || '—')}</td>
          <td style="white-space:nowrap">
            <button class="btn ghost" data-in="${m.id}">📥 รับเข้า</button>
            ${manage ? `<button class="btn ghost" data-adj="${m.id}" title="ปรับยอดจากการนับ">🔧</button>
            <button class="btn ghost" data-edit="${m.id}" title="แก้ไขวัสดุ">✏️</button>` : ''}
          </td>
        </tr>
        ${stockFormFor?.materialId === m.id ? `<tr><td colspan="9">${stockForm(m)}</td></tr>` : ''}`).join('')}
      </tbody></table>
    </div>
    <div class="card">
      <h3 style="margin-top:0">ประวัติรับ–จ่ายล่าสุด</h3>
      <table class="mini-table"><thead><tr><th>เมื่อ</th><th>วัสดุ</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
      <tbody>${moves.map((mv) => `<tr>
        <td class="muted">${dateTH(mv.createdAt, true)}</td>
        <td>${esc(mv.materialName)}</td>
        <td>${mv.type === 'in' ? '📥 รับเข้า' : mv.type === 'out' ? '📤 จ่ายผลิต' : '🔧 ปรับยอด'}</td>
        <td class="num" style="color:${mv.type === 'out' ? '#f1707a' : 'var(--green)'}">${mv.type === 'out' ? '−' : '+'}${fmtN(Math.abs(mv.qty))}</td>
        <td class="num muted">${fmtN(mv.balanceAfter)}</td>
        <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(mv.note || mv.refType)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">ยังไม่มีความเคลื่อนไหว</td></tr>'}</tbody></table>
    </div>
    ${manage && stockFormFor?.mode === 'new' ? `<div class="card">${materialForm(null)}</div>` : ''}
  </div>`;

  main.querySelectorAll('[data-in]').forEach((b) => b.onclick = () => { stockFormFor = { materialId: b.dataset.in, mode: 'in' }; renderStock(main); });
  main.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => { stockFormFor = { materialId: b.dataset.adj, mode: 'adjust' }; renderStock(main); });
  main.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { stockFormFor = { materialId: b.dataset.edit, mode: 'edit' }; renderStock(main); });
  if ($('#mNew')) $('#mNew').onclick = () => { stockFormFor = { materialId: null, mode: 'new' }; renderStock(main); };
  wireStockForms(main);
}

function stockForm(m) {
  const mode = stockFormFor.mode;
  if (mode === 'edit') return materialForm(m);
  if (mode === 'in') {
    return `<div class="inline-form" data-sform="in" data-mid="${m.id}">
      ${m.rollSqm ? `<div><label class="muted" style="font-size:11px">จำนวนม้วน (${m.rollWidthCm}ซม.×${m.rollLengthM}ม. = ${fmtN(m.rollSqm)} ตร.ม./ม้วน)</label><input data-k="rolls" type="number" min="0" step="0.5" style="width:110px" /></div>
      <span class="muted">หรือ</span>` : ''}
      <div><label class="muted" style="font-size:11px">จำนวน (${m.unit === 'sqm' ? 'ตร.ม.' : m.unit})</label><input data-k="qty" type="number" min="0" step="0.01" style="width:110px" /></div>
      <div><label class="muted" style="font-size:11px">ราคาทุน/หน่วย (฿)</label><input data-k="unitCost" type="number" min="0" step="0.01" placeholder="${m.costPerUnit}" style="width:110px" /></div>
      <div><label class="muted" style="font-size:11px">โน้ต</label><input data-k="note" placeholder="เช่น ซื้อจาก ${esc(m.supplier || 'ผู้ขาย')}" style="width:180px" /></div>
      <button class="btn" data-save="in">📥 บันทึกรับเข้า</button>
      <button class="btn ghost" data-cancel="1">ยกเลิก</button>
    </div>`;
  }
  return `<div class="inline-form" data-sform="adjust" data-mid="${m.id}">
    <div><label class="muted" style="font-size:11px">ผลต่าง +/− (${m.unit === 'sqm' ? 'ตร.ม.' : m.unit}) เช่น -3.5</label><input data-k="qty" type="number" step="0.01" style="width:130px" /></div>
    <div><label class="muted" style="font-size:11px">เหตุผล</label><input data-k="note" placeholder="นับสต๊อกจริง / ของเสีย" style="width:220px" /></div>
    <button class="btn" data-save="adjust">🔧 ปรับยอด</button>
    <button class="btn ghost" data-cancel="1">ยกเลิก</button>
  </div>`;
}

function materialForm(m) {
  const v = (k, d = '') => esc(m?.[k] ?? d);
  return `<div class="form-grid" data-sform="material" data-mid="${m?.id || ''}">
    <div><label>รหัส (SKU)</label><input data-k="sku" value="${v('sku')}" /></div>
    <div style="grid-column:span 2"><label>ชื่อวัสดุ</label><input data-k="name" value="${v('name')}" placeholder="เช่น สติกเกอร์ PVC ใส" /></div>
    <div><label>หมวด</label><select data-k="category">${['sticker', 'laminate', 'ink', 'core', 'packaging', 'other'].map((c) => `<option value="${c}" ${m?.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div><label>หน่วย</label><select data-k="unit">${['sqm', 'pcs', 'roll', 'liter'].map((u) => `<option value="${u}" ${m?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
    <div><label>หน้ากว้างม้วน (ซม.)</label><input data-k="rollWidthCm" type="number" value="${v('rollWidthCm')}" /></div>
    <div><label>ความยาวม้วน (ม.)</label><input data-k="rollLengthM" type="number" value="${v('rollLengthM')}" /></div>
    <div><label>ทุน/หน่วย (฿)</label><input data-k="costPerUnit" type="number" step="0.01" value="${v('costPerUnit', 0)}" /></div>
    <div><label>จุดสั่งซื้อ</label><input data-k="reorderPoint" type="number" value="${v('reorderPoint', 0)}" /></div>
    ${m ? '' : '<div><label>ยอดเริ่มต้น</label><input data-k="stockQty" type="number" value="0" /></div>'}
    <div><label>ผู้ขาย</label><input data-k="supplier" value="${v('supplier')}" /></div>
    ${m ? `<div><label>สถานะ</label><select data-k="active"><option value="true" ${m.active !== false ? 'selected' : ''}>ใช้งาน</option><option value="false" ${m.active === false ? 'selected' : ''}>ปิดใช้</option></select></div>` : ''}
    <div><button class="btn" data-save="material">💾 บันทึกวัสดุ</button> <button class="btn ghost" data-cancel="1">ยกเลิก</button></div>
  </div>`;
}

function wireStockForms(main) {
  main.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => { stockFormFor = null; renderStock(main); });
  main.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
    const form = b.closest('[data-sform]');
    const kind = form.dataset.sform;
    const vals = {};
    form.querySelectorAll('[data-k]').forEach((i) => { vals[i.dataset.k] = i.value; });
    try {
      if (kind === 'in') {
        const body = { materialId: form.dataset.mid, note: vals.note, unitCost: vals.unitCost || null };
        if (vals.rolls) body.rolls = Number(vals.rolls); else body.qty = Number(vals.qty);
        await api('/erp/stock/in', { method: 'POST', body: JSON.stringify(body) });
      } else if (kind === 'adjust') {
        await api('/erp/stock/adjust', { method: 'POST', body: JSON.stringify({ materialId: form.dataset.mid, qty: Number(vals.qty), note: vals.note }) });
      } else if (kind === 'material') {
        if (vals.active !== undefined) vals.active = vals.active === 'true';
        if (form.dataset.mid) await api('/erp/materials/' + form.dataset.mid, { method: 'PUT', body: JSON.stringify(vals) });
        else await api('/erp/materials', { method: 'POST', body: JSON.stringify(vals) });
      }
      stockFormFor = null;
      renderStock(main); refreshBadges();
    } catch (e) { alert(e.message); }
  });
}

// ── Customers ────────────────────────────────────────────────────────────────
async function renderCustomers(main, query) {
  state.boot = await api('/erp/bootstrap');
  const selectedId = query.id || null;
  const selected = selectedId ? state.boot.customers.find((c) => c.id === selectedId) : null;
  const orders = selected ? await api('/erp/orders?q=' + encodeURIComponent(selected.name)) : [];

  main.innerHTML = `<div class="admin">
    <div class="erp-toolbar"><h2 style="margin:0">👥 ลูกค้า</h2></div>
    <div class="report-cols">
      <div class="card">
        <table><thead><tr><th>ลูกค้า</th><th>เทียร์</th><th>โทร</th><th class="num">บล็อก</th></tr></thead>
        <tbody>${state.boot.customers.map((c) => `
          <tr class="clickable ${c.id === selectedId ? 'low-row' : ''}" onclick="location.hash='#customers?id=${c.id}'">
            <td><b>${esc(c.name)}</b>${c.conversationId ? ' <span class="chip ads">💬</span>' : ''}</td>
            <td><span class="chip">${TIER_LABEL[c.tier] || c.tier}</span></td>
            <td class="muted">${esc(c.phone || '—')}</td>
            <td class="num">${state.boot.dies.filter((d) => d.customerId === c.id).length}</td>
          </tr>`).join('')}</tbody></table>
        <div class="inline-form">
          <input id="cName" placeholder="ชื่อลูกค้าใหม่" style="flex:1" />
          <select id="cTier">${Object.entries(TIER_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <input id="cPhone" placeholder="โทร" style="width:130px" />
          <button class="btn" id="cAdd">＋ เพิ่ม</button>
        </div>
      </div>
      <div class="card">
        ${selected ? `
          <h3 style="margin-top:0">${esc(selected.name)}</h3>
          <div class="form-grid">
            <div><label>เทียร์ราคา</label><select id="cdTier">${Object.entries(TIER_LABEL).map(([k, v]) => `<option value="${k}" ${selected.tier === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            <div><label>โทร</label><input id="cdPhone" value="${esc(selected.phone || '')}" /></div>
            <div><label>เลขภาษี</label><input id="cdTax" value="${esc(selected.taxId || '')}" /></div>
            <div style="grid-column:1/-1"><label>ที่อยู่</label><input id="cdAddr" value="${esc(selected.address || '')}" /></div>
            <div style="grid-column:1/-1"><label>โน้ต</label><input id="cdNote" value="${esc(selected.note || '')}" /></div>
            <div><button class="btn ghost" id="cdSave">💾 บันทึก</button></div>
            <div><button class="btn" onclick="location.hash='#new-quote?customer=${selected.id}'">🧮 ตีราคาให้ลูกค้านี้</button></div>
          </div>
          <h3>🧰 บล็อกไดคัทของลูกค้า</h3>
          ${state.boot.dies.filter((d) => d.customerId === selected.id).map((d) => `
            <div class="reminder-item">${esc(d.name)} <span class="muted">· ${esc(d.sizeSpec || '')} · ${esc(d.location || '')}</span></div>`).join('') || '<p class="muted" style="font-size:12px">ยังไม่มีบล็อก</p>'}
          <div class="inline-form">
            <input id="dieName" placeholder="ชื่อบล็อก เช่น วงรี 6×4" style="flex:1" />
            <input id="dieSize" placeholder="ขนาด/รูปทรง" style="width:120px" />
            <input id="dieLoc" placeholder="ที่เก็บ" style="width:100px" />
            <button class="btn ghost" id="dieAdd">＋ บล็อก</button>
          </div>
          <h3>ประวัติงาน</h3>
          ${orders.length ? `<table class="mini-table"><tbody>${orders.slice(0, 8).map((oo) => `
            <tr class="clickable" onclick="location.hash='#order/${oo.id}'">
              <td><b>${esc(oo.number)}</b></td><td>${stChip(oo.status)}</td>
              <td class="num">${fmtB(oo.grandTotal)}</td><td>${payChip(oo.paymentStatus)}</td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted" style="font-size:12px">ยังไม่มีใบงาน</p>'}
        ` : '<p class="muted">เลือกลูกค้าจากตารางซ้ายเพื่อดูรายละเอียด</p>'}
      </div>
    </div>
  </div>`;

  $('#cAdd').onclick = async () => {
    const name = $('#cName').value.trim();
    if (!name) return;
    try {
      const c = await api('/erp/customers', { method: 'POST', body: JSON.stringify({ name, tier: $('#cTier').value, phone: $('#cPhone').value }) });
      location.hash = '#customers?id=' + c.id;
    } catch (e) { alert(e.message); }
  };
  if (selected) {
    $('#cdSave').onclick = async () => {
      try {
        await api('/erp/customers/' + selected.id, { method: 'PUT', body: JSON.stringify({
          tier: $('#cdTier').value, phone: $('#cdPhone').value, taxId: $('#cdTax').value,
          address: $('#cdAddr').value, note: $('#cdNote').value,
        }) });
        renderCustomers(main, { id: selected.id });
      } catch (e) { alert(e.message); }
    };
    $('#dieAdd').onclick = async () => {
      const name = $('#dieName').value.trim();
      if (!name) return;
      try {
        await api('/erp/dies', { method: 'POST', body: JSON.stringify({ customerId: selected.id, name, sizeSpec: $('#dieSize').value, location: $('#dieLoc').value }) });
        renderCustomers(main, { id: selected.id });
      } catch (e) { alert(e.message); }
    };
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────
async function renderSettings(main) {
  const s = await api('/erp/settings');
  const manage = state.boot.canManage;
  const dis = manage ? '' : 'disabled';
  main.innerHTML = `<div class="admin">
    <h2>⚙️ ตั้งค่า ERP</h2>
    <div class="card"><h3 style="margin-top:0">ข้อมูลบริษัท (ขึ้นบนเอกสาร)</h3>
      <div class="form-grid">
        <div style="grid-column:span 2"><label>ชื่อกิจการ</label><input id="sName" value="${esc(s.company.name)}" ${dis} /></div>
        <div><label>โทร</label><input id="sPhone" value="${esc(s.company.phone)}" ${dis} /></div>
        <div><label>เลขผู้เสียภาษี</label><input id="sTax" value="${esc(s.company.taxId)}" ${dis} /></div>
        <div style="grid-column:1/-1"><label>ที่อยู่</label><input id="sAddr" value="${esc(s.company.address)}" ${dis} /></div>
      </div>
    </div>
    <div class="card"><h3 style="margin-top:0">ภาษี</h3>
      <div class="form-grid">
        <div><label style="display:inline-flex;gap:6px;align-items:center;color:var(--text);font-size:13px"><input type="checkbox" id="sVat" ${s.vat.enabled ? 'checked' : ''} ${dis} /> จด VAT — เอกสารคิดภาษี</label></div>
        <div><label>อัตรา VAT (%)</label><input id="sVatRate" type="number" value="${s.vat.rate}" ${dis} /></div>
        <div><label style="display:inline-flex;gap:6px;align-items:center;color:var(--text);font-size:13px"><input type="checkbox" id="sWht" ${s.wht.enabled ? 'checked' : ''} ${dis} /> แสดงหัก ณ ที่จ่าย</label></div>
        <div><label>อัตราหัก ณ ที่จ่าย (%)</label><input id="sWhtRate" type="number" value="${s.wht.rate}" ${dis} /></div>
      </div>
      <p class="muted" style="font-size:12px">ยังไม่จด VAT ให้ปิดไว้ — พอจดแล้วติ๊กเปิด เอกสารทุกใบจะคิด VAT ให้อัตโนมัติ</p>
    </div>
    <div class="card"><h3 style="margin-top:0">อัตราคิดราคา (฿/ตร.ม. เว้นแต่ระบุ)</h3>
      <div class="form-grid">
        <div><label>ค่าพิมพ์ (หมึก+เครื่อง+แรง)</label><input id="pPrint" type="number" value="${s.pricing.printCostPerSqm}" ${dis} /></div>
        <div><label>เคลือบเงา</label><input id="pGloss" type="number" value="${s.pricing.laminate.gloss}" ${dis} /></div>
        <div><label>เคลือบด้าน</label><input id="pMatte" type="number" value="${s.pricing.laminate.matte}" ${dis} /></div>
        <div><label>เคลือบ UV</label><input id="pUv" type="number" value="${s.pricing.laminate.uv}" ${dis} /></div>
        <div><label>ค่าบล็อกไดคัทใหม่ (฿)</label><input id="pDieFee" type="number" value="${s.pricing.dieCutSetupFee}" ${dis} /></div>
        <div><label>ค่าไดคัท</label><input id="pDie" type="number" value="${s.pricing.dieCutPerSqm}" ${dis} /></div>
        <div><label>ค่าตัดตรง</label><input id="pCut" type="number" value="${s.pricing.cutPerSqm}" ${dis} /></div>
        <div><label>เผื่อเสีย (%)</label><input id="pWaste" type="number" value="${s.pricing.wastePct}" ${dis} /></div>
        <div><label>กำไร ทั่วไป (%)</label><input id="pMr" type="number" value="${s.pricing.margin.retail}" ${dis} /></div>
        <div><label>กำไร ขายส่ง (%)</label><input id="pMw" type="number" value="${s.pricing.margin.wholesale}" ${dis} /></div>
        <div><label>กำไร VIP (%)</label><input id="pMv" type="number" value="${s.pricing.margin.vip}" ${dis} /></div>
        <div><label>ราคาขั้นต่ำ/งาน (฿)</label><input id="pMin" type="number" value="${s.pricing.minJobPrice}" ${dis} /></div>
      </div>
    </div>
    <div class="card"><h3 style="margin-top:0">ข้อความแจ้งลูกค้าในแชต ({{number}} = เลขงาน, {{tracking}} = พัสดุ)</h3>
      <div class="form-grid">
        <div style="grid-column:1/-1"><label>เมื่อเข้าคิวผลิต</label><input id="tQueued" value="${esc(s.notifyTemplates.queued)}" ${dis} /></div>
        <div style="grid-column:1/-1"><label>เมื่อเริ่มพิมพ์</label><input id="tPrinting" value="${esc(s.notifyTemplates.printing)}" ${dis} /></div>
        <div style="grid-column:1/-1"><label>เมื่อจัดส่ง</label><input id="tShipped" value="${esc(s.notifyTemplates.shipped)}" ${dis} /></div>
      </div>
    </div>
    ${manage ? '<button class="btn" id="sSave">💾 บันทึกการตั้งค่า</button> <span id="sResult" class="muted"></span>' : '<p class="muted">ต้องมีสิทธิ์ Manage ERP (Owner/Admin/Manager)</p>'}
  </div>`;
  if (!manage) return;
  $('#sSave').onclick = async () => {
    try {
      const next = await api('/erp/settings', { method: 'PUT', body: JSON.stringify({
        company: { name: $('#sName').value, phone: $('#sPhone').value, taxId: $('#sTax').value, address: $('#sAddr').value },
        vat: { enabled: $('#sVat').checked, rate: Number($('#sVatRate').value) },
        wht: { enabled: $('#sWht').checked, rate: Number($('#sWhtRate').value) },
        pricing: {
          printCostPerSqm: Number($('#pPrint').value),
          laminate: { gloss: Number($('#pGloss').value), matte: Number($('#pMatte').value), uv: Number($('#pUv').value) },
          dieCutSetupFee: Number($('#pDieFee').value), dieCutPerSqm: Number($('#pDie').value),
          cutPerSqm: Number($('#pCut').value), wastePct: Number($('#pWaste').value),
          margin: { retail: Number($('#pMr').value), wholesale: Number($('#pMw').value), vip: Number($('#pMv').value) },
          minJobPrice: Number($('#pMin').value),
        },
        notifyTemplates: { queued: $('#tQueued').value, printing: $('#tPrinting').value, shipped: $('#tShipped').value },
      }) });
      state.boot.settings = next;
      $('#sResult').textContent = '✓ บันทึกแล้ว';
    } catch (e) { $('#sResult').textContent = '✕ ' + e.message; }
  };
}

// ── Print views ──────────────────────────────────────────────────────────────
async function renderPrint(main, kind, id) {
  let html = '';
  if (kind === 'quote') {
    const { quote: q, customer, settings } = await api('/erp/quotes/' + id);
    html = printDoc({
      settings, title: 'ใบเสนอราคา / Quotation', number: q.number, date: q.createdAt,
      extra: `ยืนราคาถึง ${dateTH(q.validUntil)}`,
      customer: { name: q.customerName, ...customer },
      items: q.items, totals: q, note: q.note,
      sigs: ['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ'],
    });
  } else if (kind === 'doc') {
    const { doc, order, customer, settings } = await api('/erp/docs/' + id);
    const title = doc.type === 'invoice'
      ? (settings.vat.enabled ? 'ใบแจ้งหนี้ / ใบกำกับภาษี' : 'ใบแจ้งหนี้ / Invoice')
      : 'ใบเสร็จรับเงิน / Receipt';
    html = printDoc({
      settings, title, number: doc.number, date: doc.createdAt,
      extra: `อ้างอิงใบงาน ${order.number}`,
      customer: { name: order.customerName, ...customer },
      items: order.items, totals: order,
      paid: doc.type === 'receipt' ? order.paidAmount : null,
      sigs: doc.type === 'receipt' ? ['ผู้รับเงิน', 'ผู้จ่ายเงิน'] : ['ผู้วางบิล', 'ผู้รับวางบิล'],
    });
  } else if (kind === 'job') {
    const { order: o, customer, settings } = await api('/erp/orders/' + id);
    html = `<div class="print-wrap">
      <div class="doc-head">
        <div><h1>ใบงานผลิต (Job Ticket)</h1><div class="muted">${esc(settings.company.name)}</div></div>
        <div style="text-align:right"><div style="font-size:20px;font-weight:700">${esc(o.number)}</div>
          <div>กำหนดส่ง: <b>${dateTH(o.dueDate)}</b>${o.priority === 'rush' ? ' 🔥 ด่วน' : ''}</div></div>
      </div>
      <p><b>ลูกค้า:</b> ${esc(o.customerName)}${customer?.phone ? ` · ${esc(customer.phone)}` : ''}</p>
      <table><thead><tr><th>#</th><th>งาน</th><th>วัสดุ</th><th>ขนาด</th><th class="num">จำนวน</th><th>เคลือบ</th><th>การตัด</th><th class="num">ตร.ม.</th></tr></thead>
      <tbody>${o.items.map((it, i) => `<tr>
        <td>${i + 1}</td><td>${esc(it.desc)}</td><td>${esc(it.spec.materialName)}</td>
        <td>${it.spec.widthCm}×${it.spec.heightCm} ซม.</td><td class="num">${fmtN(it.spec.qty)}</td>
        <td>${LAM_LABEL[it.spec.laminate]}</td>
        <td>${CUT_LABEL[it.spec.cutType]}${it.spec.dieMode === 'existing' ? ' (บล็อกเดิม)' : it.spec.dieMode === 'new' ? ' (ทำบล็อกใหม่)' : ''}</td>
        <td class="num">${fmtN(it.usedSqm)}</td>
      </tr>`).join('')}</tbody></table>
      <table><thead><tr><th>ขั้นตอน</th><th>พิมพ์</th><th>เคลือบ</th><th>ไดคัท/ตัด</th><th>QC</th><th>แพ็ค</th></tr></thead>
      <tbody><tr><td>ผู้ทำ / เวลา</td><td style="height:44px"></td><td></td><td></td><td></td><td></td></tr></tbody></table>
      ${o.shipping?.address ? `<p><b>จัดส่ง:</b> ${esc(o.shipping.address)}</p>` : ''}
    </div>`;
  }
  main.innerHTML = html + `<div class="print-bar">
    <button class="btn" onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button>
    <button class="btn ghost" onclick="history.back()">← กลับ</button>
  </div>`;
}

function printDoc({ settings, title, number, date, extra, customer, items, totals, paid = null, note = '', sigs = [] }) {
  const c = settings.company;
  return `<div class="print-wrap">
    <div class="doc-head">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="muted" style="font-size:12px">${esc(c.address || '')}${c.phone ? ` · โทร ${esc(c.phone)}` : ''}${c.taxId ? `<br/>เลขประจำตัวผู้เสียภาษี ${esc(c.taxId)}` : ''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700">${esc(title)}</div>
        <div>เลขที่ <b>${esc(number)}</b></div>
        <div>วันที่ ${dateTH(date)}</div>
        ${extra ? `<div class="muted" style="font-size:12px">${esc(extra)}</div>` : ''}
      </div>
    </div>
    <p><b>ลูกค้า:</b> ${esc(customer.name)}${customer.taxId ? ` · เลขภาษี ${esc(customer.taxId)}` : ''}${customer.phone ? ` · โทร ${esc(customer.phone)}` : ''}
    ${customer.address ? `<br/><span class="muted" style="font-size:12px">${esc(customer.address)}</span>` : ''}</p>
    <table><thead><tr><th>#</th><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">จำนวนเงิน</th></tr></thead>
    <tbody>${items.map((it, i) => `<tr>
      <td>${i + 1}</td><td>${esc(it.desc)}</td>
      <td class="num">${fmtN(it.spec.qty)}</td><td class="num">${fmtN(it.unitPrice)}</td><td class="num">${fmtN(it.amount)}</td>
    </tr>`).join('')}</tbody></table>
    <table class="totals"><tbody>
      <tr><td>รวมเป็นเงิน</td><td class="num">${fmtN(totals.subTotal)}</td></tr>
      ${totals.discount ? `<tr><td>ส่วนลด</td><td class="num">−${fmtN(totals.discount)}</td></tr>` : ''}
      ${totals.vat?.enabled ? `<tr><td>ภาษีมูลค่าเพิ่ม ${totals.vat.rate}%</td><td class="num">${fmtN(totals.vat.amount)}</td></tr>` : ''}
      <tr class="grand"><td>ยอดสุทธิ</td><td class="num">${fmtN(totals.grandTotal)}</td></tr>
      ${totals.wht?.enabled ? `<tr><td>หัก ณ ที่จ่าย ${totals.wht.rate}%</td><td class="num">−${fmtN(totals.wht.amount)}</td></tr>
      <tr><td>ยอดรับสุทธิ</td><td class="num">${fmtN(totals.netReceivable)}</td></tr>` : ''}
      ${paid != null ? `<tr><td><b>รับชำระแล้ว</b></td><td class="num"><b>${fmtN(paid)}</b></td></tr>` : ''}
    </tbody></table>
    ${note ? `<p class="muted" style="font-size:12px">หมายเหตุ: ${esc(note)}</p>` : ''}
    ${sigs.length ? `<div class="sig-row">${sigs.map((s) => `<div class="sig"><div class="line"></div>${esc(s)}<br/>วันที่ ______________</div>`).join('')}</div>` : ''}
  </div>`;
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:20px">Boot error: ${esc(e.message)}</pre>`; });
