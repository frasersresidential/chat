// OmniChat agent console — zero-build vanilla SPA.
const state = {
  token: null,
  user: null,
  users: [],
  meta: null,
  view: 'inbox',
  inboxMode: 'my',
  searchQuery: '',
  reportRange: 'all',
  conversations: [],
  selectedId: null,
  thread: null,
  notifications: [],
  ws: null,
  pendingAttachments: [],
  canned: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const waitedMin = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
const timeAgo = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
};

// Customer avatar (real profile photo if we have one, else the channel glyph).
function avatarHtml(c, size = 38) {
  const m = (state.meta?.channels?.[c.channel]) || {};
  if (c.customer?.avatar) {
    return `<div class="conv-avatar has-img" style="width:${size}px;height:${size}px">
      <img src="${esc(c.customer.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'"/>
      <span class="ch-badge" style="background:${m.color || '#1f6feb'}">${m.icon || ''}</span></div>`;
  }
  return `<div class="conv-avatar" style="width:${size}px;height:${size}px;background:${m.color || '#1f6feb'}">${m.icon || '👤'}</div>`;
}

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
  localStorage.removeItem('omnichat_token');
  location.reload();
}
const can = (perm) => (state.meta?.permissions || []).includes(perm);

// ── Attachments / media ───────────────────────────────────────────────────────
function renderAttachments(atts) {
  if (!atts || !atts.length) return '';
  return `<div class="att-wrap">` + atts.map((a) => {
    if (a.type === 'image') return `<a href="${esc(a.url)}" target="_blank"><img class="att-img" src="${esc(a.url)}" alt="${esc(a.name || '')}" /></a>`;
    if (a.type === 'video') return `<video class="att-img" src="${esc(a.url)}" controls></video>`;
    if (a.type === 'audio') return `<audio src="${esc(a.url)}" controls></audio>`;
    return `<a class="att-file" href="${esc(a.url)}" target="_blank">📎 ${esc(a.name || 'file')}</a>`;
  }).join('') + `</div>`;
}

// Upload a File via raw body (keeps the server dependency-free). Returns the
// stored attachment descriptor { url, type, mime, name }.
async function uploadFile(file) {
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name || 'file'),
      authorization: state.token ? 'Bearer ' + state.token : '',
    },
    body: file,
  });
  if (!res.ok) throw new Error('upload failed');
  return res.json();
}

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin(err) {
  $('#app').classList.add('hidden');
  let ov = document.getElementById('loginOverlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'loginOverlay'; document.body.appendChild(ov); }
  ov.className = 'login-overlay';
  ov.innerHTML = `<form class="login-card" id="loginForm">
    <div class="login-brand">📨 OmniChat</div>
    <div class="login-sub">เข้าสู่ระบบเพื่อใช้งาน</div>
    ${err ? `<div class="login-err">${esc(err)}</div>` : ''}
    <input id="liEmail" type="email" placeholder="อีเมล" value="u_owner@company-a.com" autocomplete="username" />
    <input id="liPass" type="password" placeholder="รหัสผ่าน" value="demo1234" autocomplete="current-password" />
    <button class="btn" type="submit" style="width:100%">เข้าสู่ระบบ</button>
    <div class="login-hint">เดโม: <b>u_owner@company-a.com</b> / <b>demo1234</b><br/>ลองบทบาทอื่น: u_manager, u_supervisor, u_sales1, u_viewer (รหัสเดียวกัน)</div>
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
      localStorage.setItem('omnichat_token', data.token);
      location.reload();
    } catch { showLogin('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'); }
  };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function boot() {
  state.token = localStorage.getItem('omnichat_token');
  if (!state.token) return showLogin();
  try {
    await loadContext();
  } catch (e) {
    localStorage.removeItem('omnichat_token');
    return showLogin();
  }
  state.users = await api('/users');
  buildUserSelector();
  wireNav();
  initSound();
  connectWs();
  render();
  refreshTaskBadge();
  if ('Notification' in window && Notification.permission === 'granted') enablePush();
}

async function loadContext() {
  const me = await api('/me');
  state.meta = me;
  state.meta.permissions = me.permissions;
  state.user = me.user;
  const fullMeta = await api('/meta');
  state.meta = { ...state.meta, ...fullMeta };
  $('#presenceSel').value = state.user.presence;
  await refreshNotifications();
}

function buildUserSelector() {
  const sel = $('#userSel');
  // The "act as" switcher is a secured impersonation, available to Owner/Admin only.
  if (can('manage_users')) {
    sel.classList.remove('hidden');
    sel.innerHTML = state.users
      .map((u) => `<option value="${u.id}" ${u.id === state.user.id ? 'selected' : ''}>${esc(u.name)} · ${u.role}</option>`)
      .join('');
    sel.onchange = async () => {
      try {
        const { token } = await api('/auth/impersonate', { method: 'POST', body: JSON.stringify({ userId: sel.value }) });
        localStorage.setItem('omnichat_token', token);
        location.reload();
      } catch (e) { alert(e.message); }
    };
  } else {
    sel.classList.add('hidden');
  }
  $('#presenceSel').onchange = async () => {
    await api('/me/presence', { method: 'PUT', body: JSON.stringify({ status: $('#presenceSel').value }) });
  };
  $('#notifBtn').onclick = () => $('#notifPanel').classList.toggle('hidden');
  $('#logoutBtn').onclick = logout;
}

function wireNav() {
  $('#nav').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      state.view = b.dataset.view;
      $('#nav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    };
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWs() {
  if (state.ws) state.ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'conversation:upserted' || msg.type === 'message:created') {
      if (state.view === 'inbox') refreshInbox();
      if (msg.type === 'message:created' && msg.conversationId === state.selectedId) openThread(state.selectedId);
      // Ping the agent on inbound messages they aren't already looking at.
      if (msg.type === 'message:created' && msg.message?.direction === 'in' &&
          (msg.conversationId !== state.selectedId || document.hidden)) {
        notifyInbound(msg.message);
      }
    } else if (msg.type === 'typing') {
      if (msg.conversationId === state.selectedId && msg.user.id !== state.user.id && msg.isTyping) showTyping(msg.user.name);
    } else if (msg.type === 'notification:created') {
      refreshNotifications();
    } else if (msg.type === 'user:presence') {
      const u = state.users.find((x) => x.id === msg.user.id);
      if (u) u.presence = msg.user.presence;
    }
  };
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function refreshNotifications() {
  refreshTaskBadge();
  state.notifications = await api('/notifications');
  const unread = state.notifications.filter((n) => !n.read).length;
  const badge = $('#notifCount');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
  $('#notifPanel').innerHTML = state.notifications.length
    ? state.notifications.map((n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-conv="${n.conversationId || ''}">
        <div class="t">${esc(n.title)}</div>
        <div class="b">${esc(n.body)} · ${timeAgo(n.createdAt)}</div>
      </div>`).join('')
    : '<div class="notif-item"><span class="muted">No notifications</span></div>';
  $('#notifPanel').querySelectorAll('.notif-item[data-id]').forEach((item) => {
    item.onclick = async () => {
      await api(`/notifications/${item.dataset.id}/read`, { method: 'POST' });
      if (item.dataset.conv) { state.view = 'inbox'; render(); await openThread(item.dataset.conv); }
      refreshNotifications();
    };
  });
}

// ── Sound & desktop notifications ─────────────────────────────────────────────
let soundEnabled = localStorage.getItem('omnichat_sound') === '1';
function initSound() {
  updateSoundBtn();
  $('#soundBtn').onclick = async () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('omnichat_sound', soundEnabled ? '1' : '0');
    if (soundEnabled && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
    }
    updateSoundBtn();
    if (soundEnabled && 'Notification' in window && Notification.permission === 'granted') enablePush();
  };
}
function updateSoundBtn() { const b = $('#soundBtn'); if (b) b.textContent = soundEnabled ? '🔊' : '🔕'; }

// ── Web Push (mobile notifications even when the app is closed) ────────────────
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key, enabled } = await api('/push/key');
    if (!enabled || !key) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    await api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
  } catch (e) { console.warn('push subscribe failed', e); }
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.07;
    o.start(); o.stop(ctx.currentTime + 0.15);
    o.onended = () => ctx.close();
  } catch { /* autoplay blocked until user interacts */ }
}
function notifyInbound(message) {
  if (!soundEnabled) return;
  beep();
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try { new Notification(message.senderName || 'ข้อความใหม่', { body: message.text || '(ไฟล์แนบ)', icon: '/icons/icon-192.png' }); }
    catch { /* ignore */ }
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
function render() {
  const main = $('#main');
  if (state.view === 'inbox') return renderInbox(main);
  if (state.view === 'tasks') return renderTasks(main);
  if (state.view === 'pipeline') return renderPipeline(main);
  if (state.view === 'channels') return renderChannels(main);
  if (state.view === 'teams') return renderTeams(main);
  if (state.view === 'users') return renderUsers(main);
  if (state.view === 'routing') return renderRouting(main);
  if (state.view === 'projects') return renderProjects(main);
  if (state.view === 'automation') return renderAutomation(main);
  if (state.view === 'broadcast') return renderBroadcast(main);
  if (state.view === 'reports') return renderReports(main);
  if (state.view === 'prospects') return renderProspects(main);
  if (state.view === 'simulator') return renderSimulator(main);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
async function renderInbox(main) {
  main.innerHTML = `
    <div class="inbox-layout">
      <div class="panel conv-list">
        <div class="search-box"><input id="searchInput" placeholder="🔍 ค้นหาแชต / ลูกค้า / ข้อความ" value="${esc(state.searchQuery)}" /></div>
        <div class="conv-tabs" id="inboxTabs">
          <button data-mode="my">My</button>
          <button data-mode="team">Team</button>
          <button data-mode="unassigned">Unassigned</button>
          <button data-mode="all">All</button>
        </div>
        <div id="convList"></div>
      </div>
      <div class="panel" id="threadPane"><div class="empty">Select a conversation</div></div>
      <div class="panel detail" id="detailPane"></div>
    </div>`;
  $('#inboxTabs').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === state.inboxMode);
    b.onclick = () => { state.searchQuery = ''; state.inboxMode = b.dataset.mode; renderInbox(main); };
  });
  let searchTimer;
  $('#searchInput').oninput = (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => doSearch(q), 250);
  };
  if (state.searchQuery) doSearch(state.searchQuery); else await refreshInbox();
  if (state.selectedId) openThread(state.selectedId);
}

async function doSearch(q) {
  state.searchQuery = q;
  const list = $('#convList');
  if (!list) return;
  if (!q.trim()) { return refreshInbox(); }
  let results = [];
  try { results = await api('/search?q=' + encodeURIComponent(q)); } catch { results = []; }
  if (!results.length) { list.innerHTML = '<div class="empty">ไม่พบผลลัพธ์</div>'; return; }
  const meta = state.meta.channels || {};
  list.innerHTML = results.map(({ conversation: c, snippet }) => {
    const m = meta[c.channel] || {};
    return `
    <div class="conv-item ${c.id === state.selectedId ? 'active' : ''}" data-id="${c.id}">
      ${avatarHtml(c)}
      <div class="conv-main">
        <div class="conv-top"><span class="conv-name">${esc(c.customer?.name)}</span>
          <span class="conv-time">${c.grade ? `<span class="grade-mini grade-${c.grade}">${c.grade}</span>` : ''}</span></div>
        <div class="conv-preview">${snippet ? '💬 ' + esc(snippet) : esc(c.accountName || c.channelLabel)}</div>
        <div class="conv-meta">${(c.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.conv-item').forEach((item) => item.onclick = () => openThread(item.dataset.id));
}

async function refreshInbox() {
  try {
    state.conversations = await api('/inbox?mode=' + state.inboxMode);
  } catch (e) { state.conversations = []; }
  const list = $('#convList');
  if (!list) return;
  if (!state.conversations.length) { list.innerHTML = '<div class="empty">No conversations</div>'; return; }
  const meta = state.meta.channels || {};
  list.innerHTML = state.conversations.map((c) => {
    const m = meta[c.channel] || {};
    return `
    <div class="conv-item ${c.id === state.selectedId ? 'active' : ''}" data-id="${c.id}">
      ${avatarHtml(c)}
      <div class="conv-main">
        <div class="conv-top">
          <span class="conv-name">${esc(c.customer?.name)}</span>
          <span class="conv-time">${timeAgo(c.lastMessageAt)}</span>
        </div>
        <div class="conv-preview">${esc(c.accountName || c.channelLabel)}</div>
        <div class="conv-meta">
          ${c.grade ? `<span class="grade-mini grade-${c.grade}">${c.grade}</span>` : ''}
          ${c.waitingSince ? `<span class="chip ${c.slaBreachedAt ? 'sla-breach' : 'waiting'}">${c.slaBreachedAt ? '🔴 SLA' : '⏳ ' + waitedMin(c.waitingSince) + 'm'}</span>` : ''}
          ${c.reminderAt ? `<span class="chip rem ${new Date(c.reminderAt) < new Date() ? 'overdue' : ''}">⏰</span>` : ''}
          ${c.project ? `<span class="chip project">🏢 ${esc(c.project.name)}</span>` : ''}
          ${c.adReferral ? '<span class="chip ads">📣 Ads</span>' : ''}
          ${c.customer?.vip ? '<span class="chip vip">★ VIP</span>' : ''}
          ${(c.tags || []).slice(0, 2).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
          ${c.assignedUserName ? `<span class="chip owner">${esc(c.assignedUserName)}</span>` : '<span class="chip unassigned">Unassigned</span>'}
          ${c.unread ? `<span class="unread-dot">${c.unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.conv-item').forEach((item) => { item.onclick = () => openThread(item.dataset.id); });
}

async function openThread(id) {
  if (id !== state.selectedId) state.pendingAttachments = [];
  state.selectedId = id;
  const data = await api('/conversations/' + id);
  state.thread = data;
  await api('/conversations/' + id + '/read', { method: 'POST' }).catch(() => {});
  document.querySelectorAll('.conv-item').forEach((i) => i.classList.toggle('active', i.dataset.id === id));
  renderThread();
  renderDetail();
  // On phones, slide into the thread view (the list is a separate screen).
  document.querySelector('.inbox-layout')?.classList.add('mobile-thread');
  document.querySelector('.inbox-layout')?.classList.remove('mobile-detail');
}

function renderThread() {
  const pane = $('#threadPane');
  if (!pane) return;
  const { conversation: c, messages } = state.thread;
  const replyDisabled = !can('reply');
  pane.classList.add('thread');
  pane.innerHTML = `
    <div class="thread-header">
      <button class="btn ghost mobile-only" id="backBtn" title="กลับ">‹</button>
      ${avatarHtml(c, 34)}
      <div>
        <div style="font-weight:600">${esc(c.customer?.name)} ${c.customer?.vip ? '★' : ''}</div>
        <div class="muted" style="font-size:12px">${esc(c.accountName)} · ${esc(c.channelLabel)}</div>
      </div>
      <div class="actions">
        ${can('reply') ? `<button class="btn ghost" id="resolveBtn">${c.status === 'resolved' ? '↩ Reopen' : '✓ ปิดงาน'}</button>` : ''}
        ${can('takeover') ? `<button class="btn ghost" id="takeoverBtn">Take over</button>` : ''}
        ${can('transfer') || can('assign') ? `<button class="btn ghost" id="assignBtn">Assign / Transfer</button>` : ''}
        <button class="btn ghost mobile-only" id="infoBtn" title="ข้อมูลลูกค้า">ℹ️</button>
      </div>
    </div>
    <div class="messages" id="messages">
      ${messages.map((m) => `
        <div class="msg ${m.direction}">
          ${m.text ? esc(m.text) : ''}
          ${renderAttachments(m.attachments)}
          <div class="meta">${esc(m.senderName || '')} · ${timeAgo(m.createdAt)}</div>
        </div>`).join('')}
    </div>
    <div id="typingInd" class="typing-ind hidden"></div>
    <div id="attachPreview" class="attach-preview"></div>
    <div id="quickPanel" class="quick-panel hidden"></div>
    <div id="emojiPanel" class="emoji-panel hidden"></div>
    <div class="composer">
      ${replyDisabled ? '' : `
        <button class="btn ghost" id="attachBtn" title="แนบรูป/วิดีโอ/ไฟล์">📎</button>
        <button class="btn ghost" id="emojiBtn" title="อิโมจิ">😀</button>
        <button class="btn ghost" id="quickBtn" title="คำตอบสำเร็จรูป">⚡</button>
        <input type="file" id="fileInput" accept="image/*,video/*,application/pdf" multiple hidden />`}
      <textarea id="replyInput" placeholder="${replyDisabled ? 'You do not have permission to reply' : 'พิมพ์ข้อความ…'}" ${replyDisabled ? 'disabled' : ''}></textarea>
      <button class="btn" id="sendBtn" ${replyDisabled ? 'disabled' : ''}>Send</button>
    </div>`;
  const msgs = $('#messages'); msgs.scrollTop = msgs.scrollHeight;
  if (!replyDisabled) {
    renderAttachPreview();
    const send = async () => {
      const t = $('#replyInput').value.trim();
      if (!t && !state.pendingAttachments.length) return;
      $('#replyInput').value = '';
      const attachments = state.pendingAttachments;
      state.pendingAttachments = [];
      try { await api('/conversations/' + c.id + '/reply', { method: 'POST', body: JSON.stringify({ text: t, attachments }) }); }
      catch (e) { alert(e.message); state.pendingAttachments = attachments; }
      openThread(c.id);
    };
    $('#sendBtn').onclick = send;
    $('#replyInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    $('#replyInput').oninput = () => sendTyping(c.id);
    // Emoji picker
    $('#emojiBtn').onclick = () => toggleEmojiPanel();
    // Attach files
    $('#attachBtn').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = async (e) => {
      for (const file of e.target.files) {
        try { state.pendingAttachments.push(await uploadFile(file)); renderAttachPreview(); }
        catch (err) { alert('อัปโหลดไม่สำเร็จ: ' + file.name); }
      }
      e.target.value = '';
    };
    // Quick replies
    $('#quickBtn').onclick = () => toggleQuickPanel(c);
  }
  if ($('#takeoverBtn')) $('#takeoverBtn').onclick = async () => {
    await api('/conversations/' + c.id + '/takeover', { method: 'POST' }); openThread(c.id); refreshInbox();
  };
  if ($('#assignBtn')) $('#assignBtn').onclick = () => assignDialog(c);
  if ($('#resolveBtn')) $('#resolveBtn').onclick = async () => {
    const next = c.status === 'resolved' ? 'open' : 'resolved';
    try { await api('/conversations/' + c.id + '/status', { method: 'POST', body: JSON.stringify({ status: next }) }); }
    catch (e) { return alert(e.message); }
    state.thread.conversation.status = next; renderThread(); refreshInbox();
  };
  // Mobile navigation: back returns to the list, info toggles the detail sheet.
  if ($('#backBtn')) $('#backBtn').onclick = () => {
    document.querySelector('.inbox-layout')?.classList.remove('mobile-thread', 'mobile-detail');
  };
  if ($('#infoBtn')) $('#infoBtn').onclick = () => {
    document.querySelector('.inbox-layout')?.classList.toggle('mobile-detail');
  };
}

function renderAttachPreview() {
  const box = $('#attachPreview');
  if (!box) return;
  if (!state.pendingAttachments.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = state.pendingAttachments.map((a, i) => `
    <span class="att-chip">
      ${a.type === 'image' ? `<img src="${esc(a.url)}"/>` : a.type === 'video' ? '🎬' : '📎'}
      <span class="att-name">${esc(a.name || a.type)}</span>
      <button data-rm="${i}" title="ลบ">✕</button>
    </span>`).join('');
  box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
    state.pendingAttachments.splice(+b.dataset.rm, 1); renderAttachPreview();
  });
}

// ── Emoji picker ──────────────────────────────────────────────────────────────
const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤩','🥰','👍','👎','🙏','👌','💪','🙌','👏','🔥','✨','🎉','❤️','💯','✅','❌','⭐','😅','😉','😢','😭','😡','🤔','😴','🥳','😇','🤗','😋','🛒','💰','💳','📦','🚚','📞','📩','⏰','🎁','💵','🏷️','😱','🙇‍♀️','🙇‍♂️','💬'];
function toggleEmojiPanel() {
  const p = $('#emojiPanel');
  if (!p) return;
  if (!p.classList.contains('hidden')) { p.classList.add('hidden'); return; }
  p.innerHTML = EMOJIS.map((e) => `<button class="emoji" type="button">${e}</button>`).join('');
  p.classList.remove('hidden');
  p.querySelectorAll('.emoji').forEach((b) => b.onclick = () => {
    const ta = $('#replyInput'); ta.value += b.textContent; ta.focus();
  });
}

// ── Typing indicator (real-time over WebSocket) ───────────────────────────────
let typingTimer = null;
let typingHideTimer = null;
function wsSend(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}
function sendTyping(conversationId) {
  wsSend({ type: 'typing', conversationId, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => wsSend({ type: 'typing', conversationId, isTyping: false }), 2500);
}
function showTyping(name) {
  const ind = $('#typingInd');
  if (!ind) return;
  ind.textContent = `${name} กำลังพิมพ์…`;
  ind.classList.remove('hidden');
  clearTimeout(typingHideTimer);
  typingHideTimer = setTimeout(() => ind.classList.add('hidden'), 3000);
}

function toggleQuickPanel(c) {
  const p = $('#quickPanel');
  if (!p) return;
  if (p.classList.contains('hidden')) openQuickPanel(c); else p.classList.add('hidden');
}
async function openQuickPanel(c) {
  const panel = $('#quickPanel');
  if (!panel) return;
  if (!state.canned) { try { state.canned = await api('/canned-responses'); } catch { state.canned = []; } }
  panel.innerHTML = `
    <div class="qp-head">⚡ คำตอบสำเร็จรูป</div>
    <div class="qp-list">${state.canned.length ? state.canned.map((q) => `
      <div class="qp-item" data-ins="${q.id}">
        <div class="qp-t">${esc(q.title)} ${q.shortcut ? `<span class="muted">${esc(q.shortcut)}</span>` : ''}
          <button class="qp-del" data-del="${q.id}" title="ลบ">✕</button></div>
        <div class="qp-b">${esc(q.text)}</div>
      </div>`).join('') : '<div class="muted" style="padding:10px">ยังไม่มีคำตอบสำเร็จรูป เพิ่มได้ด้านล่าง</div>'}</div>
    <div class="qp-add">
      <input id="qpTitle" placeholder="หัวข้อ" />
      <input id="qpText" placeholder="ข้อความสำเร็จรูป" />
      <button class="btn" id="qpAdd">+ เพิ่ม</button>
    </div>`;
  panel.classList.remove('hidden');
  panel.querySelectorAll('.qp-item').forEach((it) => it.onclick = (e) => {
    if (e.target.closest('[data-del]')) return;
    const q = state.canned.find((x) => x.id === it.dataset.ins);
    const ta = $('#replyInput'); ta.value = (ta.value ? ta.value + ' ' : '') + q.text; ta.focus();
    panel.classList.add('hidden');
  });
  panel.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    try { await api('/canned-responses/' + b.dataset.del, { method: 'DELETE' }); } catch (err) { return alert(err.message); }
    state.canned = state.canned.filter((x) => x.id !== b.dataset.del);
    openQuickPanel(c);
  });
  $('#qpAdd').onclick = async () => {
    const title = $('#qpTitle').value.trim(), text = $('#qpText').value.trim();
    if (!title || !text) return;
    try {
      state.canned.push(await api('/canned-responses', { method: 'POST', body: JSON.stringify({ title, text }) }));
      openQuickPanel(c);
    } catch (err) { alert(err.message); }
  };
}

async function assignDialog(c) {
  const agents = state.users.filter((u) => u.organizationId === c.organizationId);
  const choice = prompt('Assign to user id:\n' + agents.map((u) => `${u.id} — ${u.name} (${u.role})`).join('\n'), c.assignedUserId || '');
  if (!choice) return;
  const endpoint = c.assignedUserId ? 'transfer' : 'assign';
  try { await api(`/conversations/${c.id}/${endpoint}`, { method: 'POST', body: JSON.stringify({ userId: choice.trim() }) }); }
  catch (e) { return alert(e.message); }
  openThread(c.id); refreshInbox();
}

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
function renderDetail() {
  const pane = $('#detailPane');
  if (!pane) return;
  const { conversation: c, assignments } = state.thread;
  const editable = can('reply');
  pane.innerHTML = `
    ${c.project ? `<div class="project-banner">🏢 โครงการ: <b>${esc(c.project.name)}</b></div>` : ''}
    <h4>Customer</h4>
    <div class="row"><span class="muted">Name</span><span>${esc(c.customer?.name)}</span></div>
    <div class="row"><span class="muted">VIP</span><span>${c.customer?.vip ? '★ Yes' : 'No'}</span></div>
    <div class="row"><span class="muted">Channel</span><span>${esc(c.channelLabel)}</span></div>
    <div class="row"><span class="muted">Account</span><span>${esc(c.accountName)}</span></div>
    <div class="row"><span class="muted">Owner</span><span>${esc(c.assignedUserName || '—')}</span></div>

    ${c.adReferral ? (() => {
      const a = c.adReferral;
      const isAd = a.source === 'ADS' || !!a.adId;
      const u = a.utm || {};
      return `
      <h4>📣 ${isAd ? 'มาจาก Meta Ads' : 'ที่มา (Referral)'}</h4>
      ${isAd ? `
        <div class="row"><span class="muted">Ad name</span><span>${esc(a.adName || a.adTitle || '—')}</span></div>
        <div class="row"><span class="muted">Ad set name</span><span>${esc(a.adsetName || '—')}</span></div>
        <div class="row"><span class="muted">Campaign</span><span>${esc(a.campaignName || '—')}</span></div>
        ${a.adId ? `<div class="row"><span class="muted">Ad ID</span><span>${esc(a.adId)}</span></div>` : ''}
        ${(!a.adName && !a.adsetName) ? `<div class="muted" style="font-size:11px">* ต้องให้ Page token มีสิทธิ์ ads_read จึงจะดึงชื่อ Ad/Ad set ได้</div>` : ''}
      ` : ''}
      ${u.source ? `<div class="row"><span class="muted">utm_source</span><span>${esc(u.source)}</span></div>` : ''}
      ${u.medium ? `<div class="row"><span class="muted">utm_medium</span><span>${esc(u.medium)}</span></div>` : ''}
      ${u.campaign ? `<div class="row"><span class="muted">utm_campaign</span><span>${esc(u.campaign)}</span></div>` : ''}
      ${a.ref ? `<div class="row"><span class="muted">ref</span><span>${esc(a.ref)}</span></div>` : ''}`;
    })() : ''}

    <h4>Pipeline stage</h4>
    <select id="stageSel" ${editable ? '' : 'disabled'}>
      ${Object.entries(STAGE_LABEL).map(([k, v]) => `<option value="${k}" ${(c.stage || 'new') === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>

    <h4>มูลค่าดีล (บาท)</h4>
    <input id="dealInput" type="number" min="0" step="any" value="${c.dealValue || ''}" placeholder="เช่น 2500000" ${editable ? '' : 'disabled'} style="width:100%" />

    <h4>⏰ ตามลูกค้า (Follow-up)</h4>
    ${(() => {
      const pend = (state.thread.reminders || []).filter((r) => !r.done);
      if (!pend.length) return '<div class="muted" style="font-size:12px;margin-bottom:6px">ยังไม่มีรายการเตือน</div>';
      return pend.map((r) => `<div class="reminder-item ${new Date(r.dueAt) < new Date() ? 'overdue' : ''}">
        <div><b>${fmtDue(r.dueAt)}</b> ${new Date(r.dueAt) < new Date() ? '<span class="chip unassigned">เลยกำหนด</span>' : ''}</div>
        <div class="muted" style="font-size:12px">${esc(r.note || 'ติดตามลูกค้า')}</div>
        ${editable ? `<div style="margin-top:4px"><button class="btn ghost" data-rdone="${r.id}">✓ เสร็จ</button> <button class="btn ghost" data-rdel="${r.id}">✕</button></div>` : ''}
      </div>`).join('');
    })()}
    ${editable ? `<div class="reminder-form">
      <div class="rem-quick">
        <button class="btn ghost" data-quick="60">+1 ชม.</button>
        <button class="btn ghost" data-quick="tomorrow10">พรุ่งนี้ 10:00</button>
        <button class="btn ghost" data-quick="4320">+3 วัน</button>
      </div>
      <input type="datetime-local" id="remWhen" />
      <input id="remNote" placeholder="โน้ต เช่น โทรตามเรื่องโปรโมชั่น" />
      <button class="btn" id="remAdd" style="width:100%">+ ตั้งเตือน</button>
    </div>` : ''}

    <h4>Grade (เกรดลูกค้า)</h4>
    <div class="grade-row">
      ${GRADES.map((g) => `<button class="grade-btn grade-${g} ${c.grade === g ? 'active' : ''}" data-grade="${g}" ${editable ? '' : 'disabled'}>${g}</button>`).join('')}
      <button class="grade-btn ${!c.grade ? 'active' : ''}" data-grade="" ${editable ? '' : 'disabled'}>—</button>
    </div>

    <h4>Tags (ป้ายกำกับ)</h4>
    <div class="tags-row" id="tagsRow">
      ${(c.tags || []).map((t) => `<span class="tag-chip">${esc(t)}${editable ? `<button data-rmtag="${esc(t)}">✕</button>` : ''}</span>`).join('') || '<span class="muted">ยังไม่มีแท็ก</span>'}
    </div>
    ${editable ? `<input id="tagInput" placeholder="เพิ่มแท็ก แล้วกด Enter" />` : ''}

    <h4>Assignment history</h4>
    ${assignments.length ? assignments.map((a) => {
      const u = state.users.find((x) => x.id === a.assignedUserId);
      return `<div class="timeline-item"><b>${esc(u?.name || a.assignedUserId)}</b> · ${a.assignmentType} · ${timeAgo(a.assignedAt)}</div>`;
    }).join('') : '<div class="muted">No assignments yet</div>'}`;

  if (!editable) return;
  $('#stageSel').onchange = async () => {
    try {
      const updated = await api('/conversations/' + c.id + '/stage', { method: 'PUT', body: JSON.stringify({ stage: $('#stageSel').value }) });
      state.thread.conversation = updated; refreshInbox();
    } catch (e) { alert(e.message); }
  };
  $('#dealInput').onchange = async () => {
    try {
      const updated = await api('/conversations/' + c.id + '/deal-value', { method: 'PUT', body: JSON.stringify({ value: $('#dealInput').value || 0 }) });
      state.thread.conversation = updated;
    } catch (e) { alert(e.message); }
  };
  // Follow-up reminders
  const addReminder = async (dueAt, note) => {
    try { await api('/conversations/' + c.id + '/reminders', { method: 'POST', body: JSON.stringify({ dueAt, note }) }); openThread(c.id); refreshTaskBadge(); }
    catch (e) { alert(e.message); }
  };
  $('#remAdd').onclick = () => {
    if (!$('#remWhen').value) return alert('เลือกวัน/เวลาก่อนค่ะ');
    addReminder(new Date($('#remWhen').value).toISOString(), $('#remNote').value);
  };
  pane.querySelectorAll('[data-quick]').forEach((b) => b.onclick = () => {
    const d = new Date();
    if (b.dataset.quick === 'tomorrow10') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    else { d.setMinutes(d.getMinutes() + Number(b.dataset.quick)); }
    addReminder(d.toISOString(), $('#remNote')?.value || '');
  });
  pane.querySelectorAll('[data-rdone]').forEach((b) => b.onclick = async () => { await api('/reminders/' + b.dataset.rdone + '/complete', { method: 'POST' }); openThread(c.id); refreshTaskBadge(); });
  pane.querySelectorAll('[data-rdel]').forEach((b) => b.onclick = async () => { await api('/reminders/' + b.dataset.rdel, { method: 'DELETE' }); openThread(c.id); refreshTaskBadge(); });
  pane.querySelectorAll('[data-grade]').forEach((b) => b.onclick = async () => {
    try {
      const updated = await api('/conversations/' + c.id + '/grade', { method: 'PUT', body: JSON.stringify({ grade: b.dataset.grade }) });
      state.thread.conversation = updated; renderDetail(); refreshInbox();
    } catch (e) { alert(e.message); }
  });
  const saveTags = async (tags) => {
    try {
      const updated = await api('/conversations/' + c.id + '/tags', { method: 'PUT', body: JSON.stringify({ tags }) });
      state.thread.conversation = updated; renderDetail(); refreshInbox();
    } catch (e) { alert(e.message); }
  };
  pane.querySelectorAll('[data-rmtag]').forEach((b) => b.onclick = () => saveTags((c.tags || []).filter((t) => t !== b.dataset.rmtag)));
  const ti = $('#tagInput');
  if (ti) ti.onkeydown = (e) => {
    if (e.key === 'Enter' && ti.value.trim()) { e.preventDefault(); saveTags([...(c.tags || []), ti.value.trim()]); }
  };
}

// ── Tasks / follow-up reminders ────────────────────────────────────────────────────
function fmtDue(iso) {
  try { return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso; }
}
async function refreshTaskBadge() {
  try {
    const rem = await api('/reminders?scope=mine');
    const due = rem.filter((r) => !r.done && new Date(r.dueAt) <= new Date()).length;
    const badge = $('#taskBadge');
    badge.textContent = due;
    badge.classList.toggle('hidden', due === 0);
  } catch { /* ignore */ }
}
async function renderTasks(main) {
  const rem = (await api('/reminders?scope=mine')).filter((r) => !r.done);
  const now = new Date();
  const groups = { overdue: [], today: [], upcoming: [] };
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  for (const r of rem) {
    const d = new Date(r.dueAt);
    if (d < now) groups.overdue.push(r); else if (d <= endToday) groups.today.push(r); else groups.upcoming.push(r);
  }
  const section = (title, list, cls) => `
    <h3 class="${cls}">${title} <span class="kcount">${list.length}</span></h3>
    ${list.length ? list.map((r) => `<div class="task-row" data-conv="${r.conversationId || ''}">
      <div class="task-main">
        <div class="task-cust">${esc(r.conversation?.customer?.name || 'ลูกค้า')} ${r.conversation?.project ? `· 🏢 ${esc(r.conversation.project.name)}` : ''}</div>
        <div class="muted" style="font-size:12px">${esc(r.note || 'ติดตามลูกค้า')}</div>
        <div class="task-due">⏰ ${fmtDue(r.dueAt)}</div>
      </div>
      <button class="btn ghost" data-done="${r.id}">✓ เสร็จ</button>
    </div>`).join('') : '<div class="muted" style="padding:6px 0">— ไม่มี —</div>'}`;
  main.innerHTML = `<div class="admin">
    <h2>Tasks — ตามลูกค้า (ของฉัน)</h2>
    <p class="muted">รายการเตือนติดตามลูกค้าที่คุณตั้งไว้ ตั้งเพิ่มได้จากแผงข้อมูลลูกค้าในแต่ละแชต</p>
    ${section('🔴 เลยกำหนด', groups.overdue, 'task-overdue')}
    ${section('🟡 วันนี้', groups.today, '')}
    ${section('🟢 กำลังจะถึง', groups.upcoming, '')}
  </div>`;
  main.querySelectorAll('[data-done]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    await api('/reminders/' + b.dataset.done + '/complete', { method: 'POST' });
    renderTasks(main); refreshTaskBadge();
  });
  main.querySelectorAll('.task-row[data-conv]').forEach((row) => row.onclick = () => {
    if (!row.dataset.conv) return;
    state.view = 'inbox'; state.selectedId = row.dataset.conv; setActiveNav('inbox'); render();
  });
}

// ── Sales pipeline (Kanban) ──────────────────────────────────────────────────────
const STAGE_LABEL = { new: 'ทักเข้ามา', contacted: 'ติดต่อแล้ว', qualified: 'สนใจ/มีโอกาส', proposal: 'เสนอราคา/นัดดู', won: '✅ ปิดการขาย', lost: '✕ ไม่สำเร็จ' };
async function renderPipeline(main) {
  const { stages, conversations } = await api('/pipeline');
  const meta = state.meta.channels || {};
  const editable = can('reply');
  const byStage = Object.fromEntries(stages.map((s) => [s, []]));
  for (const c of conversations) (byStage[c.stage || 'new'] || byStage.new).push(c);

  main.innerHTML = `<div class="pipeline">
    ${stages.map((s) => `
      <div class="kcol" data-stage="${s}">
        <div class="kcol-head">${STAGE_LABEL[s] || s} <span class="kcount">${byStage[s].length}</span></div>
        <div class="kcol-body" data-stage="${s}">
          ${byStage[s].map((c) => {
            const m = meta[c.channel] || {};
            return `<div class="kcard" draggable="${editable}" data-id="${c.id}">
              <div class="kcard-top">
                <span class="kcard-name">${esc(c.customer?.name)}</span>
                ${c.grade ? `<span class="grade-mini grade-${c.grade}">${c.grade}</span>` : ''}
              </div>
              <div class="kcard-sub">${m.icon || ''} ${esc(c.accountName || c.channelLabel)}</div>
              <div class="kcard-meta">
                ${c.project ? `<span class="chip project">🏢 ${esc(c.project.name)}</span>` : ''}
                ${c.adReferral ? '<span class="chip ads">📣</span>' : ''}
                ${c.customer?.vip ? '<span class="chip vip">★</span>' : ''}
                ${(c.tags || []).slice(0, 2).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
                ${c.assignedUserName ? `<span class="chip owner">${esc(c.assignedUserName)}</span>` : '<span class="chip unassigned">—</span>'}
                ${c.status === 'resolved' ? '<span class="chip">resolved</span>' : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
  </div>`;

  // open conversation on click
  main.querySelectorAll('.kcard').forEach((card) => {
    card.onclick = () => { state.view = 'inbox'; state.selectedId = card.dataset.id; setActiveNav('inbox'); render(); };
    if (editable) card.ondragstart = (e) => { e.dataTransfer.setData('text/id', card.dataset.id); card.classList.add('dragging'); };
    if (editable) card.ondragend = () => card.classList.remove('dragging');
  });
  if (!editable) return;
  main.querySelectorAll('.kcol-body').forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/id');
      try { await api('/conversations/' + id + '/stage', { method: 'PUT', body: JSON.stringify({ stage: col.dataset.stage }) }); renderPipeline(main); }
      catch (err) { alert(err.message); }
    };
  });
}
function setActiveNav(view) {
  $('#nav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.view === view));
}

// ── Channels admin ─────────────────────────────────────────────────────────────
// Credential fields the connect/edit form exposes per channel type.
const CRED_FIELDS = {
  line: [['accessToken', 'Channel Access Token'], ['channelSecret', 'Channel Secret']],
  messenger: [['accessToken', 'Page Access Token'], ['appSecret', 'App Secret'], ['verifyToken', 'Verify Token']],
  instagram: [['accessToken', 'Page Access Token'], ['appSecret', 'App Secret'], ['verifyToken', 'Verify Token']],
  whatsapp: [['accessToken', 'Access Token'], ['appSecret', 'App Secret'], ['verifyToken', 'Verify Token']],
  tiktok: [['clientKey', 'Client Key'], ['clientSecret', 'Client Secret'], ['accessToken', 'Access Token']],
  x: [['bearerToken', 'Bearer Token'], ['apiSecret', 'API Secret'], ['accessToken', 'Access Token']],
  mock: [],
};
const webhookUrl = (type) => `${location.origin}/webhooks/${type}`;
let editingChannelId = null;

async function renderChannels(main) {
  const accounts = await api('/channel-accounts');
  const manage = can('manage_channels');
  main.innerHTML = `<div class="admin">
    <h2>Channel Accounts & Connections</h2>
    <p class="muted">One organization, many accounts per channel. Empty credentials run in simulated mode. Point each platform's webhook to the URL shown below.</p>
    <div class="card">
      <table><thead><tr><th>Channel</th><th>Account</th><th>Webhook URL</th><th>Connection</th><th>Status</th>${manage ? '<th></th>' : ''}</tr></thead>
      <tbody>${accounts.map((a) => {
        const m = state.meta.channels[a.channelType] || {};
        const configured = Object.values(a.credential).some(Boolean);
        return `
        <tr>
          <td>${m.icon||''} ${esc(m.label||a.channelType)}</td>
          <td>${esc(a.accountName)}<div class="muted" style="font-size:11px">${esc(a.accountId)}</div></td>
          <td><code class="hookurl" data-url="${webhookUrl(a.channelType)}" title="Click to copy">${esc(webhookUrl(a.channelType))}</code></td>
          <td><span class="pill ${configured ? 'role-agent' : ''}">${configured ? '● connected' : '○ simulated'}</span> <span class="muted" style="font-size:11px">${esc(a.webhookStatus)}</span></td>
          <td><span class="dot ${a.status === 'active' ? 'online' : 'offline'}"></span>${esc(a.status)}</td>
          ${manage ? `<td style="white-space:nowrap">
            <button class="btn ghost" data-edit="${a.id}">Edit</button>
            <button class="btn ghost" data-toggle="${a.id}" data-next="${a.status === 'active' ? 'inactive' : 'active'}">${a.status === 'active' ? 'Disable' : 'Enable'}</button>
            <button class="btn ghost" data-del="${a.id}">✕</button>
          </td>` : ''}
        </tr>
        ${manage && editingChannelId === a.id ? `<tr><td colspan="6">${channelEditForm(a)}</td></tr>` : ''}`;
      }).join('')}</tbody></table>
    </div>
    ${manage ? channelForm() : '<p class="muted">You need Manage Channels permission to add or edit accounts.</p>'}
  </div>`;

  // copy webhook url on click
  main.querySelectorAll('.hookurl').forEach((c) => c.onclick = () => {
    navigator.clipboard?.writeText(c.dataset.url); c.textContent = '✓ copied'; setTimeout(() => c.textContent = c.dataset.url, 900);
  });
  if (!manage) return;
  main.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { editingChannelId = editingChannelId === b.dataset.edit ? null : b.dataset.edit; renderChannels(main); });
  main.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => { await api('/channel-accounts/' + b.dataset.toggle, { method: 'PUT', body: JSON.stringify({ status: b.dataset.next }) }); renderChannels(main); });
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Remove this channel account and its routing rules?')) { await api('/channel-accounts/' + b.dataset.del, { method: 'DELETE' }); editingChannelId = null; renderChannels(main); } });
  if (editingChannelId) wireChannelEditForm(accounts.find((a) => a.id === editingChannelId), main);
  wireChannelForm();
}

function channelEditForm(a) {
  const fields = CRED_FIELDS[a.channelType] || [];
  return `<div class="card" style="margin:8px 0">
    <h3>Edit ${esc(a.accountName)}</h3>
    <div class="form-grid">
      <div><label>Account name</label><input id="ceName" value="${esc(a.accountName)}" /></div>
      <div><label>External account id</label><input id="ceId" value="${esc(a.accountId)}" /></div>
      ${fields.map(([k, lbl]) => `<div><label>${lbl}</label><input data-cred="${k}" placeholder="${a.credential[k] ? '•••• configured (leave blank to keep)' : 'not set'}" /></div>`).join('')}
      <div><button class="btn" id="ceSave">Save</button></div>
    </div>
    <p class="muted" style="font-size:11px">Secrets are write-only — existing values are never shown. Leave a field blank to keep it.</p>
  </div>`;
}
function wireChannelEditForm(a, main) {
  $('#ceSave').onclick = async () => {
    const credential = {};
    main.querySelectorAll('[data-cred]').forEach((i) => { if (i.value.trim()) credential[i.dataset.cred] = i.value.trim(); });
    try {
      await api('/channel-accounts/' + a.id, { method: 'PUT', body: JSON.stringify({
        accountName: $('#ceName').value, accountId: $('#ceId').value,
        ...(Object.keys(credential).length ? { credential } : {}),
      }) });
      editingChannelId = null; renderChannels(main);
    } catch (e) { alert(e.message); }
  };
}
function channelForm() {
  return `<div class="card"><h3>Connect new account</h3>
    <div class="form-grid">
      <div><label>Channel</label><select id="cfType">${state.meta.channelTypes.map((t) => `<option value="${t}">${(state.meta.channels[t]||{}).label||t}</option>`).join('')}</select></div>
      <div><label>Account name</label><input id="cfName" placeholder="LINE OA Brand C" /></div>
      <div><label>External account id</label><input id="cfId" placeholder="line_brand_c" /></div>
      <div><label>Access token (optional)</label><input id="cfToken" placeholder="connect later via Edit" /></div>
      <div><button class="btn" id="cfAdd">Add account</button></div>
    </div></div>`;
}
function wireChannelForm() {
  $('#cfAdd').onclick = async () => {
    try {
      await api('/channel-accounts', { method: 'POST', body: JSON.stringify({
        channelType: $('#cfType').value, accountName: $('#cfName').value,
        accountId: $('#cfId').value, credential: $('#cfToken').value ? { accessToken: $('#cfToken').value } : {},
      }) });
      renderChannels($('#main'));
    } catch (e) { alert(e.message); }
  };
}

// ── Teams admin ─────────────────────────────────────────────────────────────────
async function renderTeams(main) {
  const tree = await api('/teams');
  const renderNode = (n) => `<li>
    <span class="team-name">${esc(n.name)}</span>
    <ul>${n.members.map((m) => `<li class="member"><span class="dot ${m.role === 'agent' ? 'online' : 'offline'}"></span>${esc(m.name)} — <span class="pill role-${m.role}">${m.teamRole || m.role}</span></li>`).join('')}
    ${(n.children || []).map(renderNode).join('')}</ul>
  </li>`;
  main.innerHTML = `<div class="admin">
    <h2>Team Hierarchy</h2>
    <div class="card tree"><ul>${tree.map(renderNode).join('')}</ul></div>
  </div>`;
}

// ── Users admin ──────────────────────────────────────────────────────────────────
async function renderUsers(main) {
  const users = await api('/users');
  state.users = users;
  const manage = can('manage_users');
  const roleOptions = (sel) => Object.entries(state.meta.roles).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v.label}</option>`).join('');
  main.innerHTML = `<div class="admin">
    <h2>Users, Access & Permissions</h2>
    <p class="muted">Invite people, set their role (which decides their permissions) and revoke access. Disabled users keep their history but can't sign in or receive chats.</p>
    <div class="card"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Presence</th><th>แชตค้าง</th><th>Access</th><th>Assignable</th>${manage ? '<th></th>' : ''}</tr></thead>
      <tbody>${users.map((u) => {
        const role = state.meta.roles[u.role] || {};
        const status = u.status || 'active';
        return `<tr>
          <td>${esc(u.name)}</td>
          <td class="muted">${esc(u.email || '—')}</td>
          <td>${manage
            ? `<select data-role-for="${u.id}">${roleOptions(u.role)}</select>`
            : `<span class="pill role-${u.role}">${esc(role.label || u.role)}</span>`}</td>
          <td><span class="dot ${u.presence}"></span>${u.presence}</td>
          <td>${u.activeChats ? `<b>${u.activeChats}</b>` : '0'}</td>
          <td><span class="pill ${status === 'active' ? 'role-agent' : ''}">${status}</span></td>
          <td>${role.eligibleForAssignment ? '✅ round robin' : '— observer/manager'}</td>
          ${manage ? `<td style="white-space:nowrap">
            ${u.activeChats ? `<button class="btn ghost" data-handover="${u.id}">โอนแชต (${u.activeChats})</button>` : ''}
            <button class="btn ghost" data-status="${u.id}" data-next="${status === 'disabled' ? 'active' : 'disabled'}">${status === 'disabled' ? 'Enable' : 'Disable'}</button>
          </td>` : ''}
        </tr>`;
      }).join('')}</tbody></table></div>
    ${manage ? `<div class="card"><h3>Invite user</h3>
      <p class="muted" style="font-size:12px">Creates the account with status “invited”. (Demo build uses act-as switching instead of passwords.)</p>
      <div class="form-grid">
      <div><label>Name</label><input id="uName" /></div>
      <div><label>Email</label><input id="uEmail" placeholder="name@company.com" /></div>
      <div><label>Role</label><select id="uRole">${roleOptions('agent')}</select></div>
      <div><button class="btn" id="uAdd">Send invite</button></div></div>
      <div class="muted" style="margin-top:10px;font-size:12px">${permissionLegend()}</div>
    </div>` : ''}
  </div>`;
  if (!manage) return;
  $('#uAdd').onclick = async () => {
    try { await api('/users', { method: 'POST', body: JSON.stringify({ name: $('#uName').value, email: $('#uEmail').value, role: $('#uRole').value }) }); renderUsers(main); }
    catch (e) { alert(e.message); }
  };
  main.querySelectorAll('[data-role-for]').forEach((s) => s.onchange = async () => {
    try { await api('/users/' + s.dataset.roleFor, { method: 'PUT', body: JSON.stringify({ role: s.value }) }); renderUsers(main); }
    catch (e) { alert(e.message); }
  });
  main.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
    if (b.dataset.next === 'disabled' && !confirm('ปิดสิทธิ์ผู้ใช้นี้? แชตที่ค้างอยู่จะถูกโอนให้ agent คนอื่นในโครงการอัตโนมัติ')) return;
    try {
      const res = await api('/users/' + b.dataset.status, { method: 'PUT', body: JSON.stringify({ status: b.dataset.next }) });
      if (res.handover) alert(`โอนแชตเรียบร้อย: ส่งต่อ ${res.handover.reassigned} ราย, ไม่มีผู้ดูแล ${res.handover.unassigned} ราย (จาก ${res.handover.total})`);
      renderUsers(main);
    } catch (e) { alert(e.message); }
  });
  main.querySelectorAll('[data-handover]').forEach((b) => b.onclick = async () => {
    if (!confirm('โอนแชตที่ค้างของผู้ใช้นี้ไปให้ agent คนอื่นในโครงการ?')) return;
    try {
      const r = await api('/users/' + b.dataset.handover + '/handover', { method: 'POST', body: JSON.stringify({}) });
      alert(`โอนแล้ว: ส่งต่อ ${r.reassigned} ราย, ไม่มีผู้ดูแล ${r.unassigned} ราย (จาก ${r.total})`);
      renderUsers(main);
    } catch (e) { alert(e.message); }
  });
}

function permissionLegend() {
  return Object.entries(state.meta.roles).map(([, v]) =>
    `<b>${esc(v.label)}</b>: ${v.eligibleForAssignment ? 'receives chats' : 'observer/manager'}`).join(' · ');
}

// ── Routing admin ────────────────────────────────────────────────────────────────
async function renderRouting(main) {
  const [rules, accounts, tree] = await Promise.all([api('/routing-rules'), api('/channel-accounts'), api('/teams')]);
  const flatTeams = []; const walk = (ns) => ns.forEach((n) => { flatTeams.push(n); walk(n.children || []); });
  walk(tree);
  const accName = (id) => accounts.find((a) => a.id === id)?.accountName || id;
  const teamName = (id) => flatTeams.find((t) => t.id === id)?.name || id;
  main.innerHTML = `<div class="admin">
    <h2>Routing Rules</h2>
    <p class="muted">Lower priority runs first. condition: always / vip / keyword. Manual = no auto owner.</p>
    <div class="card"><table>
      <thead><tr><th>Channel Account</th><th>Condition</th><th>→ Team</th><th>Type</th><th>Role override</th><th>Priority</th>${can('manage_routing') ? '<th></th>' : ''}</tr></thead>
      <tbody>${rules.sort((a, b) => a.priority - b.priority).map((r) => `<tr>
        <td>${esc(accName(r.channelAccountId))}</td>
        <td>${r.condition.type}${r.condition.keywords ? ` [${r.condition.keywords.join(', ')}]` : ''}</td>
        <td>${esc(teamName(r.teamId))}</td>
        <td><span class="pill">${r.routingType}</span></td>
        <td>${r.assignToRole || '—'}</td>
        <td>${r.priority}</td>
        ${can('manage_routing') ? `<td><button class="btn ghost" data-del="${r.id}">✕</button></td>` : ''}
      </tr>`).join('')}</tbody></table></div>
    ${can('manage_routing') ? `<div class="card"><h3>Add rule</h3><div class="form-grid">
      <div><label>Channel account</label><select id="rAcc">${accounts.map((a) => `<option value="${a.id}">${esc(a.accountName)}</option>`).join('')}</select></div>
      <div><label>Team</label><select id="rTeam">${flatTeams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div><label>Routing type</label><select id="rType"><option value="round_robin">round_robin</option><option value="manual">manual</option></select></div>
      <div><label>Condition</label><select id="rCond"><option value="always">always</option><option value="vip">vip</option><option value="keyword">keyword (ข้อความ)</option><option value="adset">adset (รหัสโครงการในชื่อ Ad set)</option></select></div>
      <div><label>Keywords / รหัสโครงการ (csv)</label><input id="rKw" placeholder="RYM,Rhythm  หรือ  refund,ร้องเรียน" /></div>
      <div><label>Priority</label><input id="rPrio" type="number" value="100" /></div>
      <div><button class="btn" id="rAdd">Add rule</button></div>
    </div></div>` : ''}
  </div>`;
  if (can('manage_routing')) {
    main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await api('/routing-rules/' + b.dataset.del, { method: 'DELETE' }); renderRouting(main); });
    $('#rAdd').onclick = async () => {
      const cond = $('#rCond').value;
      const condition = (cond === 'keyword' || cond === 'adset')
        ? { type: cond, keywords: $('#rKw').value.split(',').map((s) => s.trim()).filter(Boolean) }
        : { type: cond };
      try {
        await api('/routing-rules', { method: 'POST', body: JSON.stringify({
          channelAccountId: $('#rAcc').value, teamId: $('#rTeam').value, routingType: $('#rType').value,
          condition, priority: Number($('#rPrio').value),
        }) });
        renderRouting(main);
      } catch (e) { alert(e.message); }
    };
  }
}

// ── Projects ─────────────────────────────────────────────────────────────────────
async function renderProjects(main) {
  const [projects, tree] = await Promise.all([api('/projects'), api('/teams')]);
  const flatTeams = []; const walk = (ns) => ns.forEach((n) => { flatTeams.push(n); walk(n.children || []); });
  walk(tree);
  const teamName = (id) => flatTeams.find((t) => t.id === id)?.name || '—';
  const manage = can('manage_routing');
  main.innerHTML = `<div class="admin">
    <h2>Projects (โครงการ)</h2>
    <p class="muted">ตั้งรหัส/คำที่อยู่ในชื่อ Ad set ของแต่ละโครงการ → ระบบจะติดป้ายโครงการบนแชตอัตโนมัติ และส่งเข้าทีม Sale ของโครงการนั้น</p>
    <div class="card"><table>
      <thead><tr><th>โครงการ</th><th>คำในชื่อ Ad set (keywords)</th><th>ทีม Sale</th>${manage ? '<th></th>' : ''}</tr></thead>
      <tbody>${projects.length ? projects.map((p) => `<tr>
        <td><span class="chip project">🏢 ${esc(p.name)}</span></td>
        <td>${(p.keywords || []).map((k) => `<span class="chip">${esc(k)}</span>`).join(' ')}</td>
        <td>${esc(teamName(p.teamId))}</td>
        ${manage ? `<td><button class="btn ghost" data-del="${p.id}">✕</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${manage ? 4 : 3}" class="muted">ยังไม่มีโครงการ</td></tr>`}</tbody>
    </table></div>
    ${manage ? `<div class="card"><h3>เพิ่มโครงการ</h3><div class="form-grid">
      <div><label>ชื่อโครงการ</label><input id="pName" placeholder="เช่น Rhythm รัชดา" /></div>
      <div><label>คำในชื่อ Ad set (คั่นด้วย ,)</label><input id="pKw" placeholder="RYM,Rhythm,ริทึ่ม" /></div>
      <div><label>ทีม Sale ของโครงการ</label><select id="pTeam"><option value="">— ไม่ผูกทีม (ติดป้ายอย่างเดียว)</option>${flatTeams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
      <div><button class="btn" id="pAdd">เพิ่มโครงการ</button></div>
    </div></div>` : '<p class="muted">ต้องมีสิทธิ์ Manage Routing</p>'}
  </div>`;
  if (!manage) return;
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await api('/projects/' + b.dataset.del, { method: 'DELETE' }); renderProjects(main); });
  $('#pAdd').onclick = async () => {
    try {
      await api('/projects', { method: 'POST', body: JSON.stringify({
        name: $('#pName').value, keywords: $('#pKw').value.split(',').map((s) => s.trim()).filter(Boolean), teamId: $('#pTeam').value || null,
      }) });
      renderProjects(main);
    } catch (e) { alert(e.message); }
  };
}

// ── Automation / chatbot ─────────────────────────────────────────────────────────
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: 'จันทร์', tue: 'อังคาร', wed: 'พุธ', thu: 'พฤหัส', fri: 'ศุกร์', sat: 'เสาร์', sun: 'อาทิตย์' };
async function renderAutomation(main) {
  const [rules, bh, sla] = await Promise.all([api('/auto-replies'), api('/business-hours'), api('/sla')]);
  const manage = can('manage_automation');
  const TYPE_LABEL = { welcome: '👋 ข้อความต้อนรับ (แชตใหม่)', away: '🌙 ตอบนอกเวลาทำการ', keyword: '🔑 ตอบตามคีย์เวิร์ด' };
  main.innerHTML = `<div class="admin">
    <h2>Automation / Chatbot</h2>
    <p class="muted">ตอบลูกค้าอัตโนมัติ: ข้อความต้อนรับเมื่อมีแชตใหม่, ตอบนอกเวลาทำการ, และตอบ FAQ ตามคีย์เวิร์ด</p>

    <div class="card">
      <h3>🕐 เวลาทำการ (Business Hours) ${bh.openNow ? '<span class="pill role-agent">● เปิดอยู่</span>' : '<span class="pill">○ นอกเวลา</span>'}</h3>
      <p class="muted">นอกเวลาทำการ ระบบจะส่งข้อความ "ตอบนอกเวลาทำการ" (กฎ away ด้านล่าง) ให้ลูกค้าอัตโนมัติ</p>
      <label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" id="bhEnabled" ${bh.enabled ? 'checked' : ''} ${manage ? '' : 'disabled'}/> เปิดใช้งานเวลาทำการ</label>
      <div style="margin:10px 0"><label class="muted" style="font-size:12px">Timezone</label><br/><input id="bhTz" value="${esc(bh.timezone)}" ${manage ? '' : 'disabled'} style="width:220px" /></div>
      <table><thead><tr><th>วัน</th><th>หยุด</th><th>เวลาเปิด</th><th>เวลาปิด</th></tr></thead>
      <tbody>${DAY_KEYS.map((k) => { const d = bh.days[k] || {}; return `<tr data-day="${k}">
        <td>${DAY_LABEL[k]}</td>
        <td><input type="checkbox" class="bhClosed" ${d.closed ? 'checked' : ''} ${manage ? '' : 'disabled'}/></td>
        <td><input type="time" class="bhOpen" value="${d.open || '09:00'}" ${manage ? '' : 'disabled'}/></td>
        <td><input type="time" class="bhClose" value="${d.close || '18:00'}" ${manage ? '' : 'disabled'}/></td>
      </tr>`; }).join('')}</tbody></table>
      ${manage ? '<button class="btn" id="bhSave" style="margin-top:10px">บันทึกเวลาทำการ</button>' : ''}
    </div>

    <div class="card">
      <h3>⏱️ SLA — แจ้งเตือนแชตค้างตอบ (เรียลไทม์)</h3>
      <p class="muted">ลูกค้ารอเกินเวลาที่ตั้งโดยยังไม่มีคนตอบ → เด้งเตือน sales เจ้าของ และ escalate หา supervisor/manager ทันที</p>
      <div class="form-grid">
        <div><label>เปิดใช้งาน</label><br/><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="slaEnabled" ${sla.enabled ? 'checked' : ''} ${manage ? '' : 'disabled'}/> เปิด</label></div>
        <div><label>ค้างตอบเกิน (นาที)</label><input type="number" id="slaMin" min="1" value="${sla.minutes}" ${manage ? '' : 'disabled'}/></div>
        <div><label>Round Robin หา agent คนอื่นในโครงการ</label><br/><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="slaReassign" ${sla.reassign !== false ? 'checked' : ''} ${manage ? '' : 'disabled'}/> เปิด</label></div>
        <div><label>Escalate หาหัวหน้า</label><br/><label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="slaEsc" ${sla.escalate ? 'checked' : ''} ${manage ? '' : 'disabled'}/> เปิด</label></div>
        ${manage ? '<div><button class="btn" id="slaSave">บันทึก SLA</button></div>' : ''}
      </div>
    </div>
    <div class="card"><table>
      <thead><tr><th>ประเภท</th><th>คีย์เวิร์ด</th><th>ข้อความ</th><th>สถานะ</th>${manage ? '<th></th>' : ''}</tr></thead>
      <tbody>${rules.length ? rules.map((r) => `<tr>
        <td>${TYPE_LABEL[r.type] || r.type}</td>
        <td>${(r.keywords || []).map((k) => `<span class="chip">${esc(k)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td>${esc(r.text)}</td>
        <td><span class="pill ${r.enabled ? 'role-agent' : ''}">${r.enabled ? 'on' : 'off'}</span></td>
        ${manage ? `<td style="white-space:nowrap">
          <button class="btn ghost" data-toggle="${r.id}" data-next="${r.enabled ? 'false' : 'true'}">${r.enabled ? 'ปิด' : 'เปิด'}</button>
          <button class="btn ghost" data-del="${r.id}">✕</button></td>` : ''}
      </tr>`).join('') : `<tr><td colspan="${manage ? 5 : 4}" class="muted">ยังไม่มีกฎ</td></tr>`}</tbody>
    </table></div>
    ${manage ? `<div class="card"><h3>เพิ่มกฎตอบอัตโนมัติ</h3><div class="form-grid">
      <div><label>ประเภท</label><select id="arType"><option value="welcome">ข้อความต้อนรับ</option><option value="away">ตอบนอกเวลา</option><option value="keyword">ตอบตามคีย์เวิร์ด</option></select></div>
      <div><label>คีย์เวิร์ด (คั่นด้วย , — เฉพาะแบบคีย์เวิร์ด)</label><input id="arKw" placeholder="ราคา, โปรโมชั่น" /></div>
      <div style="grid-column:1/-1"><label>ข้อความตอบกลับ</label><input id="arText" placeholder="สวัสดีค่ะ ยินดีให้บริการ…" /></div>
      <div><button class="btn" id="arAdd">เพิ่มกฎ</button></div>
    </div></div>` : '<p class="muted">ต้องมีสิทธิ์ Manage Automation</p>'}
  </div>`;
  if (!manage) return;
  $('#slaSave').onclick = async () => {
    try { await api('/sla', { method: 'PUT', body: JSON.stringify({ enabled: $('#slaEnabled').checked, minutes: Number($('#slaMin').value), escalate: $('#slaEsc').checked, reassign: $('#slaReassign').checked }) }); renderAutomation(main); }
    catch (e) { alert(e.message); }
  };
  $('#bhSave').onclick = async () => {
    const days = {};
    main.querySelectorAll('tr[data-day]').forEach((tr) => {
      days[tr.dataset.day] = {
        closed: tr.querySelector('.bhClosed').checked,
        open: tr.querySelector('.bhOpen').value || '09:00',
        close: tr.querySelector('.bhClose').value || '18:00',
      };
    });
    try {
      await api('/business-hours', { method: 'PUT', body: JSON.stringify({ enabled: $('#bhEnabled').checked, timezone: $('#bhTz').value.trim(), days }) });
      renderAutomation(main);
    } catch (e) { alert(e.message); }
  };
  main.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => { await api('/auto-replies/' + b.dataset.toggle, { method: 'PUT', body: JSON.stringify({ enabled: b.dataset.next === 'true' }) }); renderAutomation(main); });
  main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await api('/auto-replies/' + b.dataset.del, { method: 'DELETE' }); renderAutomation(main); });
  $('#arAdd').onclick = async () => {
    try {
      await api('/auto-replies', { method: 'POST', body: JSON.stringify({
        type: $('#arType').value, text: $('#arText').value,
        keywords: $('#arKw').value.split(',').map((s) => s.trim()).filter(Boolean),
      }) });
      renderAutomation(main);
    } catch (e) { alert(e.message); }
  };
}

// ── Broadcast ────────────────────────────────────────────────────────────────────
async function renderBroadcast(main) {
  if (!can('manage_automation')) { main.innerHTML = `<div class="admin"><h2>Broadcast</h2><p class="muted">ต้องมีสิทธิ์ Manage Automation</p></div>`; return; }
  const accounts = await api('/channel-accounts');
  main.innerHTML = `<div class="admin">
    <h2>Broadcast — ยิงข้อความหาลูกค้า</h2>
    <p class="muted">ส่งข้อความหาลูกค้าหลายคนพร้อมกัน กรองตามช่องทาง/เกรด/แท็ก แล้วดูจำนวนผู้รับก่อนส่ง</p>
    <div class="card"><div class="form-grid">
      <div><label>ช่องทาง</label><select id="bChannel"><option value="">ทุกช่องทาง</option>${state.meta.channelTypes.map((t) => `<option value="${t}">${(state.meta.channels[t] || {}).label || t}</option>`).join('')}</select></div>
      <div><label>เกรด</label><select id="bGrade"><option value="">ทุกเกรด</option>${['A','B','C','D','E','F'].map((g) => `<option value="${g}">เกรด ${g}</option>`).join('')}</select></div>
      <div><label>แท็ก (ตรงทั้งคำ)</label><input id="bTag" placeholder="เช่น สนใจคอนโด" /></div>
      <div style="grid-column:1/-1"><label>ข้อความ</label><input id="bText" placeholder="📢 โปรโมชั่นพิเศษเดือนนี้…" /></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center">
      <button class="btn ghost" id="bPreview">ดูจำนวนผู้รับ</button>
      <span id="bCount" class="muted"></span>
      <button class="btn" id="bSend">ส่ง Broadcast</button>
    </div>
    <div id="bResult" class="muted" style="margin-top:10px"></div></div>
  </div>`;
  const filter = () => ({ channel: $('#bChannel').value || undefined, grade: $('#bGrade').value || undefined, tag: $('#bTag').value.trim() || undefined });
  const qs = (f) => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  $('#bPreview').onclick = async () => {
    const { count } = await api('/broadcast/audience?' + qs(filter()));
    $('#bCount').textContent = `→ จะส่งถึง ${count} แชต`;
  };
  $('#bSend').onclick = async () => {
    const text = $('#bText').value.trim();
    if (!text) return alert('ใส่ข้อความก่อนค่ะ');
    const { count } = await api('/broadcast/audience?' + qs(filter()));
    if (!count) return alert('ไม่มีผู้รับตามเงื่อนไขนี้');
    if (!confirm(`ยืนยันส่งถึง ${count} แชต?`)) return;
    try {
      const r = await api('/broadcast', { method: 'POST', body: JSON.stringify({ text, filter: filter() }) });
      $('#bResult').textContent = `✓ ส่งสำเร็จ ${r.sent} แชต`;
    } catch (e) { $('#bResult').textContent = '✕ ' + e.message; }
  };
}

// ── Reports / analytics ────────────────────────────────────────────────────────────
async function downloadCSV(type) {
  const res = await fetch(`/api/reports/export?type=${type}&range=${state.reportRange}`, { headers: { authorization: state.token ? 'Bearer ' + state.token : '' } });
  if (!res.ok) return alert('export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `omnichat-${type}.csv`; a.click();
  URL.revokeObjectURL(url);
}

async function renderReports(main) {
  let r;
  try { r = await api('/reports?range=' + state.reportRange); }
  catch (e) { main.innerHTML = `<div class="admin"><h2>Reports</h2><p class="muted">You need View Analytics permission (Owner / Admin / Manager).</p></div>`; return; }

  const [pending, daily] = await Promise.all([api('/reports/pending').catch(() => null), api('/daily-report').catch(() => null)]);
  const t = r.totals;
  const channelLabel = (k) => (state.meta.channels[k] || {}).label || k;
  const channelIcon = (k) => (state.meta.channels[k] || {}).icon || '';
  const maxCh = Math.max(1, ...Object.values(r.byChannel));
  const maxDay = Math.max(1, ...r.volumeByDay.map((d) => d.count));
  const maxAg = Math.max(1, ...r.byAgent.map((a) => a.assigned));

  const stat = (label, value, sub = '') =>
    `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>`;
  const bar = (label, value, max, color = 'var(--accent)') =>
    `<div class="barrow"><span class="barlbl">${label}</span><span class="bartrack"><span class="barfill" style="width:${(value / max) * 100}%;background:${color}"></span></span><span class="barval">${value}</span></div>`;

  main.innerHTML = `<div class="admin">
    <div class="report-toolbar">
      <h2 style="margin:0">Reports & Analytics</h2>
      <div class="report-actions">
        <select id="rangeSel">
          <option value="all">ทั้งหมด</option>
          <option value="7">7 วันล่าสุด</option>
          <option value="30">30 วันล่าสุด</option>
          <option value="90">90 วันล่าสุด</option>
        </select>
        <button class="btn ghost" id="expConv">⬇️ Export แชต (CSV)</button>
        <button class="btn ghost" id="expAgents">⬇️ Export agent (CSV)</button>
      </div>
    </div>
    <div class="stat-grid">
      ${stat('Conversations', t.conversations)}
      ${stat('Open', t.open)}
      ${stat('Unassigned', t.unassigned)}
      ${stat('Avg first response', r.avgFirstResponseMin != null ? r.avgFirstResponseMin + 'm' : '—', 'inbound → first reply')}
      ${stat('VIP chats', t.vip)}
      ${stat('Agents online', t.agentsOnline)}
      ${stat('แชตจากโฆษณา', t.fromAds || 0)}
      ${stat('ปิดการขายจากโฆษณา', t.adsWon || 0, t.fromAds ? `${(t.adsWon / t.fromAds * 100).toFixed(1)}% conversion` : '')}
      ${stat('รายได้จากโฆษณา', '฿' + (t.adsRevenue || 0).toLocaleString())}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">📊 แชตค้างตอบตอนนี้ (${pending?.totalPending || 0} ราย)</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${daily ? `<label class="muted" style="font-size:12px">ส่งทุกวัน <input type="time" id="drTime" value="${daily.time}" style="width:108px" /></label>
          <label style="display:inline-flex;gap:4px;align-items:center;font-size:12px"><input type="checkbox" id="drEnabled" ${daily.enabled ? 'checked' : ''} /> เปิด</label>
          <button class="btn ghost" id="drSave">บันทึก</button>` : ''}
          <button class="btn" id="drSend">ส่งให้หัวหน้าเดี๋ยวนี้</button>
        </div>
      </div>
      <p class="muted" style="font-size:12px">ระบบส่งสรุปนี้ให้ Supervisor / Manager อัตโนมัติทุกวัน — ค้างที่ sales คนไหน โครงการอะไร กี่ราย</p>
      ${pending && pending.byAgent.length ? `<table>
        <thead><tr><th>พนักงานขาย</th><th>ค้างตอบ</th><th>แยกตามโครงการ</th></tr></thead>
        <tbody>${pending.byAgent.map((a) => `<tr>
          <td>${esc(a.name)}</td><td><b>${a.count}</b></td>
          <td>${Object.entries(a.projects).map(([p, n]) => `<span class="chip">${esc(p)}: ${n}</span>`).join(' ')}</td>
        </tr>`).join('')}
        ${pending.unassignedPending ? `<tr><td class="muted">ยังไม่มอบหมาย</td><td><b>${pending.unassignedPending}</b></td><td></td></tr>` : ''}
        </tbody></table>` : '<p class="muted">ไม่มีแชตค้างตอบ 🎉</p>'}
      <div id="drResult" class="muted" style="margin-top:8px"></div>
    </div>

    <div class="report-cols">
      <div class="card">
        <h3>Conversations by channel</h3>
        ${Object.keys(r.byChannel).length
          ? Object.entries(r.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => bar(`${channelIcon(k)} ${channelLabel(k)}`, v, maxCh)).join('')
          : '<p class="muted">No data yet</p>'}
      </div>
      <div class="card">
        <h3>Daily volume (7 days)</h3>
        ${r.volumeByDay.map((d) => bar(d.date.slice(5), d.count, maxDay, 'var(--green)')).join('')}
      </div>
    </div>

    <div class="card">
      <h3>Agent performance</h3>
      <table>
        <thead><tr><th>Agent</th><th>Role</th><th>Presence</th><th>Assigned</th><th>Open</th><th>Replies</th><th>Load</th></tr></thead>
        <tbody>${r.byAgent.length ? r.byAgent.map((a) => `<tr>
          <td>${esc(a.name)}</td>
          <td><span class="pill role-${a.role}">${esc((state.meta.roles[a.role] || {}).label || a.role)}</span></td>
          <td><span class="dot ${a.presence}"></span>${a.presence}</td>
          <td>${a.assigned}</td><td>${a.open}</td><td>${a.replies}</td>
          <td><span class="bartrack" style="width:120px"><span class="barfill" style="width:${(a.assigned / maxAg) * 100}%"></span></span></td>
        </tr>`).join('') : '<tr><td colspan="7" class="muted">No agents with conversations yet</td></tr>'}</tbody>
      </table>
    </div>

    <div class="report-cols">
      <div class="card">
        <h3>Lead grade distribution (A–F)</h3>
        ${(() => { const g = r.byGrade || {}; const max = Math.max(1, ...Object.values(g));
          return ['A','B','C','D','E','F','ungraded'].map((k) => bar(k === 'ungraded' ? 'ยังไม่จัดเกรด' : `เกรด ${k}`, g[k] || 0, max, gradeColor(k))).join(''); })()}
      </div>
      <div class="card">
        <h3>Assignment distribution</h3>
        ${Object.keys(r.assignmentByType).length
          ? Object.entries(r.assignmentByType).map(([k, v]) => bar(k, v, Math.max(1, ...Object.values(r.assignmentByType)), 'var(--orange)')).join('')
          : '<p class="muted">No assignments yet</p>'}
      </div>
    </div>

    <div class="card">
      <h3>Sales pipeline funnel</h3>
      ${(() => { const s = r.byStage || {}; const max = Math.max(1, ...Object.values(s));
        const lbl = { new: 'ทักเข้ามา', contacted: 'ติดต่อแล้ว', qualified: 'สนใจ/มีโอกาส', proposal: 'เสนอราคา/นัดดู', won: '✅ ปิดการขาย', lost: '✕ ไม่สำเร็จ' };
        return ['new','contacted','qualified','proposal','won','lost'].map((k) => bar(lbl[k], s[k] || 0, max, k === 'won' ? 'var(--green)' : k === 'lost' ? 'var(--red)' : 'var(--accent)')).join(''); })()}
    </div>

    <div class="report-cols">
      <div class="card">
        <h3>📣 แชตจาก Facebook Ads — แยกตาม Ad set</h3>
        ${(() => { const a = r.byAdSet || {}; const ks = Object.keys(a); if (!ks.length) return `<p class="muted">ยังไม่มีแชตจากโฆษณา (${r.totals.fromAds || 0})</p>`;
          const max = Math.max(1, ...Object.values(a));
          return Object.entries(a).sort((x, y) => y[1] - x[1]).map(([k, v]) => bar(k, v, max, '#7c5cff')).join(''); })()}
      </div>
      <div class="card">
        <h3>📣 แชตจาก Facebook Ads — แยกตาม Ad</h3>
        ${(() => { const a = r.byAd || {}; const ks = Object.keys(a); if (!ks.length) return '<p class="muted">—</p>';
          const max = Math.max(1, ...Object.values(a));
          return Object.entries(a).sort((x, y) => y[1] - x[1]).map(([k, v]) => bar(k, v, max, '#7c5cff')).join(''); })()}
      </div>
    </div>

    <div class="card">
      <h3>🏢 ผลลัพธ์ต่อโครงการ (Project)</h3>
      ${(r.projectReport && r.projectReport.length) ? `<table>
        <thead><tr><th>โครงการ</th><th>แชต</th><th>ปิดได้ (won)</th><th>เสีย (lost)</th><th>Conversion</th><th>รายได้</th></tr></thead>
        <tbody>${r.projectReport.map((p) => `<tr>
          <td><span class="chip project">🏢 ${esc(p.project)}</span></td><td>${p.chats}</td><td>${p.won}</td><td>${p.lost}</td>
          <td><b>${p.conversion}%</b></td><td>฿${(p.revenue || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted">ยังไม่มีแชตที่จับคู่โครงการได้ — ตั้งค่าที่แท็บ Projects แล้วให้แชตมาจาก Meta ads ที่มีรหัสโครงการในชื่อ Ad set</p>'}
    </div>

    <div class="card">
      <h3>💰 ROI โฆษณา → ปิดการขาย (ต่อ Ad set)</h3>
      ${(r.adRoi && r.adRoi.length) ? `<table>
        <thead><tr><th>Ad set</th><th>แชต</th><th>ปิดได้ (won)</th><th>เสีย (lost)</th><th>Conversion</th><th>รายได้</th></tr></thead>
        <tbody>${r.adRoi.map((a) => `<tr>
          <td>${esc(a.adset)}</td><td>${a.chats}</td><td>${a.won}</td><td>${a.lost}</td>
          <td><b>${a.conversion}%</b></td><td>฿${(a.revenue || 0).toLocaleString()}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="muted">ยังไม่มีแชตจากโฆษณา — ใส่ Ad ใน Simulator หรือต่อเพจจริง แล้วเลื่อน stage เป็น won + กรอกมูลค่าดีล</p>'}
    </div>
  </div>`;
  $('#rangeSel').value = state.reportRange;
  $('#rangeSel').onchange = () => { state.reportRange = $('#rangeSel').value; renderReports(main); };
  $('#expConv').onclick = () => downloadCSV('conversations');
  $('#expAgents').onclick = () => downloadCSV('agents');
  if ($('#drSend')) $('#drSend').onclick = async () => {
    try { const res = await api('/reports/daily/send', { method: 'POST' }); $('#drResult').textContent = `✓ ส่งสรุปให้หัวหน้าแล้ว ${res.sent} คน (ค้างตอบ ${res.summary.totalPending} ราย)`; }
    catch (e) { $('#drResult').textContent = '✕ ' + e.message; }
  };
  if ($('#drSave')) $('#drSave').onclick = async () => {
    try { await api('/daily-report', { method: 'PUT', body: JSON.stringify({ enabled: $('#drEnabled').checked, time: $('#drTime').value }) }); $('#drResult').textContent = '✓ บันทึกการตั้งเวลาแล้ว'; }
    catch (e) { $('#drResult').textContent = '✕ ' + e.message; }
  };
}
function gradeColor(g) {
  return { A: '#2ea043', B: '#3fb950', C: '#d29922', D: '#db8b00', E: '#da7633', F: '#da3633', ungraded: '#8b949e' }[g] || 'var(--accent)';
}

// ── Prospects (interest scoring) ──────────────────────────────────────────────────
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

async function renderProspects(main) {
  state.prospectTier = state.prospectTier || '';
  let data;
  try {
    const qs = new URLSearchParams();
    if (state.prospectTier) qs.set('tier', state.prospectTier);
    if (state.prospectQuery) qs.set('q', state.prospectQuery);
    data = await api('/leads?' + qs.toString());
  } catch (e) {
    main.innerHTML = `<div class="admin"><h2>Prospects</h2><p class="muted">ต้องมีสิทธิ์ View Analytics (Owner / Admin / Manager) จึงจะใช้งานได้</p></div>`;
    return;
  }
  const s = data.summary;
  const leads = data.leads;
  const stat = (label, value, sub = '') =>
    `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>`;

  main.innerHTML = `<div class="admin">
    <div class="report-toolbar">
      <h2 style="margin:0">🎯 Prospect Scoring — คะแนนความน่าสนใจลูกค้า</h2>
      <div class="report-actions">
        <input id="pSearch" placeholder="ค้นหา ชื่อ/เบอร์/โครงการ" value="${esc(state.prospectQuery || '')}" style="min-width:180px" />
        <select id="pTier">
          <option value="">ทุกระดับ</option>
          <option value="hot" ${state.prospectTier === 'hot' ? 'selected' : ''}>🔥 Hot</option>
          <option value="warm" ${state.prospectTier === 'warm' ? 'selected' : ''}>🌤️ Warm</option>
          <option value="cold" ${state.prospectTier === 'cold' ? 'selected' : ''}>❄️ Cold</option>
        </select>
        <label class="btn" style="cursor:pointer">⬆️ นำเข้าไฟล์ (xlsx/csv)<input type="file" id="pFile" accept=".xlsx,.csv" hidden /></label>
        <button class="btn ghost" id="pExport">⬇️ Export CSV</button>
        ${s.total ? '<button class="btn ghost" id="pClear">ล้างข้อมูล</button>' : ''}
      </div>
    </div>

    <p class="muted" style="font-size:12px;margin-top:-4px">
      ระบบให้คะแนน 0–100 จาก <b>Intent</b> (ความพร้อมซื้อ: เกรด, สถานะ, กลับมาดูซ้ำ, ระยะเวลาตัดสินใจ, สัญญาณในโน้ต)
      + <b>Fit</b> (ตรงกลุ่มเป้าหมาย: รายได้, งบ, อาชีพ, ช่องทาง, พื้นที่) — คำนวณในเครื่อง ไม่ต้องต่อ LLM
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
      <div style="font-size:42px">📥</div>
      <h3>ยังไม่มีข้อมูลลูกค้า</h3>
      <p class="muted">นำเข้าไฟล์รายงาน (เช่น CoSale Visit & Revisit Report .xlsx หรือ .csv) เพื่อให้ระบบวิเคราะห์และจัดอันดับ prospect ที่น่าสนใจที่สุด</p>
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

  // Filters
  $('#pTier').onchange = () => { state.prospectTier = $('#pTier').value; renderProspects(main); };
  let searchTimer;
  $('#pSearch').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.prospectQuery = $('#pSearch').value.trim(); renderProspects(main); }, 300);
  };
  // Import
  $('#pFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const label = main.querySelector('label.btn');
    const prev = label.innerHTML; label.innerHTML = '⏳ กำลังวิเคราะห์…';
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: {
          authorization: state.token ? 'Bearer ' + state.token : '',
          'content-type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: await file.arrayBuffer(),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'import failed');
      alert(`✓ นำเข้าสำเร็จ ${out.imported} ราย (ใหม่ ${out.created} · อัปเดต ${out.updated})\n🔥 Hot ${out.tierCounts.hot} · 🌤️ Warm ${out.tierCounts.warm} · ❄️ Cold ${out.tierCounts.cold}`);
      renderProspects(main);
    } catch (err) { alert('✕ ' + err.message); label.innerHTML = prev; }
  };
  if ($('#pExport')) $('#pExport').onclick = async () => {
    const res = await fetch('/api/leads/export' + (state.prospectTier ? '?tier=' + state.prospectTier : ''), { headers: { authorization: state.token ? 'Bearer ' + state.token : '' } });
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prospects.csv'; a.click();
  };
  if ($('#pClear')) $('#pClear').onclick = async () => {
    if (!confirm('ลบข้อมูลลูกค้าที่นำเข้าทั้งหมด?')) return;
    await api('/leads', { method: 'DELETE' });
    renderProspects(main);
  };
  // Expand a row to show the scoring breakdown.
  main.querySelectorAll('.prospect-table tbody tr[data-id]').forEach((tr) => {
    tr.onclick = () => toggleProspectDetail(tr);
  });
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
    <td><b>${esc(l.customerName || '—')}</b>${l.converted ? ' <span class="chip" style="color:#2ea043">✓ ปิดได้</span>' : ''}<div class="muted" style="font-size:11px">${esc(l.mobile || '')}</div></td>
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
  let lead;
  try { lead = await api('/leads/' + tr.dataset.id); } catch { return; }
  const groups = { intent: 'Intent — ความพร้อมซื้อ', fit: 'Fit — ตรงกลุ่มเป้าหมาย' };
  const factorHtml = (g) => (lead.factors || []).filter((f) => f.group === g).map((f) =>
    `<div class="barrow"><span class="barlbl" title="${esc(f.detail)}">${esc(f.label)}</span>
      <span class="bartrack"><span class="barfill" style="width:${(f.points / f.max) * 100}%"></span></span>
      <span class="barval">${f.points}/${f.max}</span></div>
      <div class="muted" style="font-size:11px;margin:-4px 0 6px 4px">${esc(f.detail)}</div>`).join('');
  const detail = document.createElement('tr');
  detail.className = 'prospect-detail';
  detail.innerHTML = `<td colspan="8"><div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:6px 4px 10px">
      <div><h4 style="margin:4px 0">${groups.intent}</h4>${factorHtml('intent')}</div>
      <div><h4 style="margin:4px 0">${groups.fit}</h4>${factorHtml('fit')}</div>
    </div>
    ${lead.notes ? `<details style="margin:0 4px 8px"><summary class="muted" style="cursor:pointer">โน้ตการเข้าชม (Visit notes)</summary>
      <pre style="white-space:pre-wrap;font-size:12px;background:var(--panel,#f6f8fa);padding:10px;border-radius:8px;max-height:240px;overflow:auto;border:1px solid var(--border)">${esc(lead.notes)}</pre></details>` : ''}</td>`;
  tr.after(detail);
}

// ── Simulator ────────────────────────────────────────────────────────────────────
async function renderSimulator(main) {
  const accounts = await api('/channel-accounts');
  main.innerHTML = `<div class="admin">
    <h2>Inbound Simulator</h2>
    <p class="muted">Send a fake customer message through the full routing pipeline (uses the mock/any account's webhook).</p>
    <div class="card"><div class="form-grid">
      <div><label>Channel account</label><select id="sAcc">${accounts.map((a) => `<option value="${a.channelType}|${a.accountId}">${esc(a.accountName)}</option>`).join('')}</select></div>
      <div><label>Customer name</label><input id="sName" value="คุณลูกค้า" /></div>
      <div><label>Customer id</label><input id="sId" value="cust_${Math.floor(Math.random()*9999)}" /></div>
      <div><label>VIP?</label><select id="sVip"><option value="">No</option><option value="1">Yes (VIP)</option></select></div>
      <div style="grid-column:1/-1"><label>Message</label><input id="sText" value="สวัสดีครับ สนใจสินค้า" /></div>
      <div style="grid-column:1/-1"><label>รูปโปรไฟล์ (URL — เว้นว่าง = สุ่มรูปให้)</label><input id="sAvatar" placeholder="https://..." /></div>
      <div><label>Ad name (จำลอง CTM ads — Messenger)</label><input id="sAdName" placeholder="เว้นว่าง = ไม่ใช่จากโฆษณา" /></div>
      <div><label>Ad set name</label><input id="sAdSet" placeholder="เช่น คนสนใจคอนโด-กรุงเทพ" /></div>
      <div><button class="btn" id="sSend">Send inbound</button></div>
    </div><div id="simResult" class="muted" style="margin-top:10px"></div></div>
  </div>`;
  $('#sSend').onclick = async () => {
    const [channel, accountId] = $('#sAcc').value.split('|');
    const avatar = $('#sAvatar').value.trim() || ('https://i.pravatar.cc/150?u=' + encodeURIComponent($('#sId').value));
    const body = { accountId, participantId: $('#sId').value, participantName: $('#sName').value, avatar, text: $('#sText').value, vip: !!$('#sVip').value, adName: $('#sAdName').value.trim(), adsetName: $('#sAdSet').value.trim() };
    const res = await fetch('/webhooks/' + channel, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildWebhookPayload(channel, body)) });
    $('#simResult').textContent = res.ok ? '✓ Sent — check the Inbox (switch user to the assigned agent if needed).' : '✕ Failed: ' + res.status;
  };
}
// Build a platform-shaped payload from the simple form (mock is pass-through).
function buildWebhookPayload(channel, b) {
  if (channel === 'mock') return b;
  if (channel === 'line') return { destination: b.accountId, events: [{ type: 'message', message: { type: 'text', id: 'm' + Date.now(), text: b.text }, source: { userId: b.participantId, displayName: b.participantName, pictureUrl: b.avatar } }] };
  if (channel === 'messenger' || channel === 'instagram') {
    const msg = { sender: { id: b.participantId, name: b.participantName, profile_pic: b.avatar }, message: { mid: 'm' + Date.now(), text: b.text } };
    if (b.adName || b.adsetName) {
      msg.referral = { source: 'ADS', type: 'OPEN_THREAD', ad_id: 'sim_' + Date.now(),
        ads_context_data: { ad_title: b.adName, ad_name: b.adName, adset_name: b.adsetName } };
    }
    return { entry: [{ id: b.accountId, messaging: [msg] }] };
  }
  if (channel === 'whatsapp') return { entry: [{ changes: [{ value: { metadata: { phone_number_id: b.accountId }, contacts: [{ wa_id: b.participantId, profile: { name: b.participantName } }], messages: [{ from: b.participantId, id: 'm' + Date.now(), text: { body: b.text }, timestamp: String(Math.floor(Date.now()/1000)) }] } }] }] };
  return b;
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:20px">Boot error: ${esc(e.message)}</pre>`; });
