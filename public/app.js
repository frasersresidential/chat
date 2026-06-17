// OmniChat agent console — zero-build vanilla SPA.
const state = {
  user: null,
  users: [],
  meta: null,
  view: 'inbox',
  inboxMode: 'my',
  conversations: [],
  selectedId: null,
  thread: null,
  notifications: [],
  ws: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const timeAgo = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h';
  return Math.floor(d / 86400) + 'd';
};

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-user-id': state.user?.id || '', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'request failed');
  }
  return res.status === 204 ? null : res.json();
}
const can = (perm) => (state.meta?.permissions || []).includes(perm);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function boot() {
  // Need a user before /api/me works; fetch users with a best-effort header.
  state.users = await fetchUsers();
  const saved = localStorage.getItem('omnichat_user');
  state.user = state.users.find((u) => u.id === saved) || state.users.find((u) => u.role === 'manager') || state.users[0];
  await loadContext();
  buildUserSelector();
  wireNav();
  connectWs();
  render();
}

async function fetchUsers() {
  // Bootstrapping: try every user id is overkill; the server lists org users for
  // any valid user. Use the well-known seeded manager id to fetch the roster.
  const res = await fetch('/api/users', { headers: { 'x-user-id': 'u_manager' } });
  if (res.ok) return res.json();
  return [];
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
  sel.innerHTML = state.users
    .map((u) => `<option value="${u.id}" ${u.id === state.user.id ? 'selected' : ''}>${esc(u.name)} · ${u.role}</option>`)
    .join('');
  sel.onchange = async () => {
    localStorage.setItem('omnichat_user', sel.value);
    state.user = state.users.find((u) => u.id === sel.value);
    await loadContext();
    connectWs();
    render();
  };
  $('#presenceSel').onchange = async () => {
    await api('/me/presence', { method: 'PUT', body: JSON.stringify({ status: $('#presenceSel').value }) });
  };
  $('#notifBtn').onclick = () => $('#notifPanel').classList.toggle('hidden');
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
  const ws = new WebSocket(`${proto}://${location.host}/ws?userId=${state.user.id}`);
  state.ws = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'conversation:upserted' || msg.type === 'message:created') {
      if (state.view === 'inbox') refreshInbox();
      if (msg.type === 'message:created' && msg.conversationId === state.selectedId) openThread(state.selectedId);
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

// ── Router ────────────────────────────────────────────────────────────────────
function render() {
  const main = $('#main');
  if (state.view === 'inbox') return renderInbox(main);
  if (state.view === 'channels') return renderChannels(main);
  if (state.view === 'teams') return renderTeams(main);
  if (state.view === 'users') return renderUsers(main);
  if (state.view === 'routing') return renderRouting(main);
  if (state.view === 'simulator') return renderSimulator(main);
}

// ── Inbox ─────────────────────────────────────────────────────────────────────
async function renderInbox(main) {
  main.innerHTML = `
    <div class="inbox-layout">
      <div class="panel conv-list">
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
    b.onclick = () => { state.inboxMode = b.dataset.mode; renderInbox(main); };
  });
  await refreshInbox();
  if (state.selectedId) openThread(state.selectedId);
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
      <div class="conv-avatar" style="background:${m.color || '#1f6feb'}">${m.icon || '👤'}</div>
      <div class="conv-main">
        <div class="conv-top">
          <span class="conv-name">${esc(c.customer?.name)}</span>
          <span class="conv-time">${timeAgo(c.lastMessageAt)}</span>
        </div>
        <div class="conv-preview">${esc(c.accountName || c.channelLabel)}</div>
        <div class="conv-meta">
          ${c.customer?.vip ? '<span class="chip vip">★ VIP</span>' : ''}
          ${c.assignedUserName ? `<span class="chip owner">${esc(c.assignedUserName)}</span>` : '<span class="chip unassigned">Unassigned</span>'}
          ${c.unread ? `<span class="unread-dot">${c.unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.conv-item').forEach((item) => { item.onclick = () => openThread(item.dataset.id); });
}

async function openThread(id) {
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
      <div class="conv-avatar" style="width:34px;height:34px;background:${(state.meta.channels[c.channel]||{}).color||'#1f6feb'}">${(state.meta.channels[c.channel]||{}).icon||'👤'}</div>
      <div>
        <div style="font-weight:600">${esc(c.customer?.name)} ${c.customer?.vip ? '★' : ''}</div>
        <div class="muted" style="font-size:12px">${esc(c.accountName)} · ${esc(c.channelLabel)}</div>
      </div>
      <div class="actions">
        ${can('takeover') ? `<button class="btn ghost" id="takeoverBtn">Take over</button>` : ''}
        ${can('transfer') || can('assign') ? `<button class="btn ghost" id="assignBtn">Assign / Transfer</button>` : ''}
        <button class="btn ghost mobile-only" id="infoBtn" title="ข้อมูลลูกค้า">ℹ️</button>
      </div>
    </div>
    <div class="messages" id="messages">
      ${messages.map((m) => `
        <div class="msg ${m.direction}">
          ${esc(m.text)}
          <div class="meta">${esc(m.senderName || '')} · ${timeAgo(m.createdAt)}</div>
        </div>`).join('')}
    </div>
    <div class="composer">
      <textarea id="replyInput" placeholder="${replyDisabled ? 'You do not have permission to reply' : 'Type a reply…'}" ${replyDisabled ? 'disabled' : ''}></textarea>
      <button class="btn" id="sendBtn" ${replyDisabled ? 'disabled' : ''}>Send</button>
    </div>`;
  const msgs = $('#messages'); msgs.scrollTop = msgs.scrollHeight;
  if (!replyDisabled) {
    const send = async () => {
      const t = $('#replyInput').value.trim();
      if (!t) return;
      $('#replyInput').value = '';
      try { await api('/conversations/' + c.id + '/reply', { method: 'POST', body: JSON.stringify({ text: t }) }); }
      catch (e) { alert(e.message); }
      openThread(c.id);
    };
    $('#sendBtn').onclick = send;
    $('#replyInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  }
  if ($('#takeoverBtn')) $('#takeoverBtn').onclick = async () => {
    await api('/conversations/' + c.id + '/takeover', { method: 'POST' }); openThread(c.id); refreshInbox();
  };
  if ($('#assignBtn')) $('#assignBtn').onclick = () => assignDialog(c);
  // Mobile navigation: back returns to the list, info toggles the detail sheet.
  if ($('#backBtn')) $('#backBtn').onclick = () => {
    document.querySelector('.inbox-layout')?.classList.remove('mobile-thread', 'mobile-detail');
  };
  if ($('#infoBtn')) $('#infoBtn').onclick = () => {
    document.querySelector('.inbox-layout')?.classList.toggle('mobile-detail');
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

function renderDetail() {
  const pane = $('#detailPane');
  if (!pane) return;
  const { conversation: c, assignments } = state.thread;
  pane.innerHTML = `
    <h4>Customer</h4>
    <div class="row"><span class="muted">Name</span><span>${esc(c.customer?.name)}</span></div>
    <div class="row"><span class="muted">VIP</span><span>${c.customer?.vip ? '★ Yes' : 'No'}</span></div>
    <div class="row"><span class="muted">Channel</span><span>${esc(c.channelLabel)}</span></div>
    <div class="row"><span class="muted">Account</span><span>${esc(c.accountName)}</span></div>
    <div class="row"><span class="muted">Owner</span><span>${esc(c.assignedUserName || '—')}</span></div>
    <h4>Assignment history</h4>
    ${assignments.length ? assignments.map((a) => {
      const u = state.users.find((x) => x.id === a.assignedUserId);
      return `<div class="timeline-item"><b>${esc(u?.name || a.assignedUserId)}</b> · ${a.assignmentType} · ${timeAgo(a.assignedAt)}</div>`;
    }).join('') : '<div class="muted">No assignments yet</div>'}`;
}

// ── Channels admin ─────────────────────────────────────────────────────────────
async function renderChannels(main) {
  const accounts = await api('/channel-accounts');
  main.innerHTML = `<div class="admin">
    <h2>Connected Channel Accounts</h2>
    <p class="muted">One organization, many accounts per channel. Empty credentials run in simulated mode.</p>
    <div class="card">
      <table><thead><tr><th>Channel</th><th>Account Name</th><th>External ID</th><th>Webhook</th><th>Status</th><th>Credentials</th></tr></thead>
      <tbody>${accounts.map((a) => `
        <tr>
          <td>${(state.meta.channels[a.channelType]||{}).icon||''} ${esc((state.meta.channels[a.channelType]||{}).label||a.channelType)}</td>
          <td>${esc(a.accountName)}</td><td class="muted">${esc(a.accountId)}</td>
          <td><span class="pill">${esc(a.webhookStatus)}</span></td>
          <td>${esc(a.status)}</td>
          <td class="muted">${Object.values(a.credential).some(Boolean) ? 'configured' : 'simulated'}</td>
        </tr>`).join('')}</tbody></table>
    </div>
    ${can('manage_channels') ? channelForm() : '<p class="muted">You need Manage Channels permission to add accounts.</p>'}
  </div>`;
  if (can('manage_channels')) wireChannelForm();
}
function channelForm() {
  return `<div class="card"><h3>Connect new account</h3>
    <div class="form-grid">
      <div><label>Channel</label><select id="cfType">${state.meta.channelTypes.map((t) => `<option value="${t}">${(state.meta.channels[t]||{}).label||t}</option>`).join('')}</select></div>
      <div><label>Account name</label><input id="cfName" placeholder="LINE OA Brand C" /></div>
      <div><label>External account id</label><input id="cfId" placeholder="line_brand_c" /></div>
      <div><label>Access token</label><input id="cfToken" placeholder="optional" /></div>
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
  main.innerHTML = `<div class="admin">
    <h2>Users & Roles</h2>
    <div class="card"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Presence</th><th>Assignable</th></tr></thead>
      <tbody>${users.map((u) => {
        const role = state.meta.roles[u.role] || {};
        return `<tr><td>${esc(u.name)}</td><td><span class="pill role-${u.role}">${esc(role.label || u.role)}</span></td>
        <td><span class="dot ${u.presence}"></span>${u.presence}</td>
        <td>${role.eligibleForAssignment ? '✅ round robin' : '— observer/manager'}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${can('manage_users') ? `<div class="card"><h3>Add user</h3><div class="form-grid">
      <div><label>Name</label><input id="uName" /></div>
      <div><label>Email</label><input id="uEmail" /></div>
      <div><label>Role</label><select id="uRole">${Object.entries(state.meta.roles).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div><button class="btn" id="uAdd">Add</button></div></div></div>` : ''}
  </div>`;
  if (can('manage_users')) $('#uAdd').onclick = async () => {
    try { await api('/users', { method: 'POST', body: JSON.stringify({ name: $('#uName').value, email: $('#uEmail').value, role: $('#uRole').value }) }); renderUsers(main); }
    catch (e) { alert(e.message); }
  };
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
      <div><label>Condition</label><select id="rCond"><option value="always">always</option><option value="vip">vip</option><option value="keyword">keyword</option></select></div>
      <div><label>Keywords (csv)</label><input id="rKw" placeholder="refund,complaint" /></div>
      <div><label>Priority</label><input id="rPrio" type="number" value="100" /></div>
      <div><button class="btn" id="rAdd">Add rule</button></div>
    </div></div>` : ''}
  </div>`;
  if (can('manage_routing')) {
    main.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await api('/routing-rules/' + b.dataset.del, { method: 'DELETE' }); renderRouting(main); });
    $('#rAdd').onclick = async () => {
      const cond = $('#rCond').value;
      const condition = cond === 'keyword' ? { type: 'keyword', keywords: $('#rKw').value.split(',').map((s) => s.trim()).filter(Boolean) } : { type: cond };
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
      <div><button class="btn" id="sSend">Send inbound</button></div>
    </div><div id="simResult" class="muted" style="margin-top:10px"></div></div>
  </div>`;
  $('#sSend').onclick = async () => {
    const [channel, accountId] = $('#sAcc').value.split('|');
    const body = { accountId, participantId: $('#sId').value, participantName: $('#sName').value, text: $('#sText').value, vip: !!$('#sVip').value };
    const res = await fetch('/webhooks/' + channel, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildWebhookPayload(channel, body)) });
    $('#simResult').textContent = res.ok ? '✓ Sent — check the Inbox (switch user to the assigned agent if needed).' : '✕ Failed: ' + res.status;
  };
}
// Build a platform-shaped payload from the simple form (mock is pass-through).
function buildWebhookPayload(channel, b) {
  if (channel === 'mock') return b;
  if (channel === 'line') return { destination: b.accountId, events: [{ type: 'message', message: { type: 'text', id: 'm' + Date.now(), text: b.text }, source: { userId: b.participantId } }] };
  if (channel === 'messenger' || channel === 'instagram') return { entry: [{ id: b.accountId, messaging: [{ sender: { id: b.participantId, name: b.participantName }, message: { mid: 'm' + Date.now(), text: b.text } }] }] };
  if (channel === 'whatsapp') return { entry: [{ changes: [{ value: { metadata: { phone_number_id: b.accountId }, contacts: [{ wa_id: b.participantId, profile: { name: b.participantName } }], messages: [{ from: b.participantId, id: 'm' + Date.now(), text: { body: b.text }, timestamp: String(Math.floor(Date.now()/1000)) }] } }] }] };
  return b;
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:20px">Boot error: ${esc(e.message)}</pre>`; });
