# OmniChat — Omni-Channel Customer Inbox

รวมทุกช่องทางแชทให้คุยกับลูกค้าในที่เดียว: **Facebook Messenger, Instagram,
WhatsApp Business, LINE OA, X (Twitter), TikTok** — พร้อมระบบจัดทีม, สิทธิ์ (RBAC),
และเครื่องมือกระจายแชต (routing engine) แบบ multi-tenant สำหรับองค์กร

> Unify every chat channel into one agent inbox, with multi-account management,
> team hierarchy, role-based permissions, and a full chat routing engine
> (round-robin / skill-based / VIP / keyword).

## ☁️ Deploy online (no install, runs 24/7)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/frasersresidential/chat)

One click → sign in with GitHub → **Apply**. Render reads `render.yaml`,
builds, and gives you an `https://…onrender.com` URL you can open from any
phone or computer. Log in with `u_owner@company-a.com` / `demo1234`.

---

## ✨ Features

| Area | What it does |
|---|---|
| **Omni-channel adapters** | Messenger, Instagram, WhatsApp, LINE OA, X, TikTok + a Mock sandbox. Each normalizes inbound webhooks into one unified message model and sends replies back through the native API. |
| **Multi-account per org** | One organization connects *many* accounts per channel (e.g. LINE OA Brand A / B / After-Sales, multiple Facebook Pages). |
| **Team hierarchy** | Organization → Department → Teams, with nested sub-teams. |
| **RBAC** | Owner, Admin, Manager, Supervisor, Sales Agent, Viewer/Observer — each with a precise permission set. |
| **Chat routing engine** | Detect channel account → match routing rule → pick team → assign agent → create conversation. |
| **Round-robin** | Fair rotation across **online** agents only; offline/busy/away are skipped. |
| **Skill-based routing** | Route a channel account to a specific team (e.g. Instagram → Marketing). |
| **VIP / priority routing** | VIP customers → Senior Sales; complaint keywords → Supervisor. |
| **Agent availability** | Online / Busy / Away / Offline presence; only Online receives assignments. |
| **Observation mode** | Managers / Viewers see all conversations without receiving ownership. |
| **Team inbox views** | My / Team / Unassigned / All. |
| **Manual takeover & transfer** | Supervisors/Managers take over or reassign — full history preserved. |
| **Notifications** | Assigned agent, supervisor high-priority alerts, in-app bell. |
| **Admin UI** | Channels, Teams, Users, Routing Rules, plus an inbound Simulator. |
| **Realtime** | WebSocket push for new messages, conversations, presence, notifications. |
| **Agent tools** | Image/video/file attachments, canned quick replies, emoji picker, live "typing…" indicator. |
| **Tags & grading** | Free-form tags + A–F lead grade per conversation; full-text search across chats. |
| **Sales pipeline** | Drag-and-drop Kanban (new→contacted→qualified→proposal→won→lost) + resolve/reopen. |
| **Automation** | Welcome / away / keyword auto-replies (chatbot) and filtered broadcast campaigns. |
| **Auth** | Email/password login with JWTs; secured Owner/Admin impersonation. |
| **Reports** | Date-range analytics, grade & pipeline funnels, agent leaderboard, CSV export. |
| **PWA** | Installable, mobile-first; sound + desktop + **Web Push** notifications (reach the phone with the app closed). |
| **Storage** | In-memory + JSON file by default; set `DATABASE_URL` for durable **Postgres** (write-through, zero code changes). |

---

> 🕵️ **มองหาแดชบอร์ดสอดแนมโฆษณาคู่แข่ง?** ดู **[adspy/](adspy/)** — แอป
> standalone แยกต่างหากในโฟลเดอร์นี้ (Meta Ad Library competitor intelligence)
> รัน/deploy อิสระจาก OmniChat

## 🚀 Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

No credentials needed — the app seeds a demo org (**Company A**) and runs every
channel in **simulated mode**. Use the **Simulator** tab (or the Mock webhook)
to push a customer message through the full routing pipeline.

**Log in** with `u_owner@company-a.com` / `demo1234` (or `u_manager`,
`u_supervisor`, `u_sales1`, `u_viewer` … same password). Owners/Admins can
"act as" any user via the top-right switcher.

📦 **Deploy + connect real LINE/Facebook:** see **[CONNECT-CHANNELS-TH.md](CONNECT-CHANNELS-TH.md)**
(Render blueprint + Dockerfile included). 📱 **Run on Windows / mobile:** see
**[QUICKSTART-TH.md](QUICKSTART-TH.md)**.

```bash
npm test     # routing / round-robin / RBAC unit tests
npm run dev  # auto-reload
```

### Try it in 30 seconds
1. Open the app → top-right, **act as** `Mia Manager` to see the **All** inbox.
2. Go to **Simulator** → pick *LINE OA Brand A*, type a message → **Send inbound**.
3. Watch it appear in the inbox, auto-assigned to a Sales agent (round-robin).
4. Send one with **VIP = Yes** → routed to *Senior Sales*.
5. Send one containing `refund` / `ร้องเรียน` → routed to a *Supervisor*.
6. Switch **act as** to the assigned agent to reply.

---

## 🏗️ Architecture

```
 Platform Webhook ─► Adapter.parseInbound() ─► ingestInbound()
                                                   │
                              Routing Engine ◄──────┤  (rule → team → agent)
                                   │                 ▼
                     conversation_assignment   Unified Store (conversations + messages)
                                   │                 │
                              Notifications     WebSocket push ─► Agent Inbox UI
                                                   ▲
 Agent reply ─► sendReply() ─► Adapter.send() ─► Platform API
```

```
src/
  channels/      adapters: base, meta(messenger/instagram), whatsapp, line, x, tiktok, mock, registry
  core/          rbac, presence, teams, routing, conversations, notifications, eventBus
  store/         db (JSON document store), seed, envCredentials
  server/        app (REST), webhooks, realtime (WebSocket)
public/          zero-build SPA agent console + admin UI
test/            routing & RBAC tests
```

The storage layer (`src/store/db.js`) is a zero-dependency JSON document store
behind a small CRUD API — swap it for Postgres/Mongo without touching business
logic.

---

## 🔌 Going live with real channels

Credentials live on each **ChannelAccount** (set them in the **Channels** admin
UI), or seed-level accounts pick them up from `.env`:

```bash
cp .env.example .env   # fill in tokens, then npm start
```

Point each platform's webhook to:

```
https://YOUR_DOMAIN/webhooks/messenger
https://YOUR_DOMAIN/webhooks/instagram
https://YOUR_DOMAIN/webhooks/whatsapp
https://YOUR_DOMAIN/webhooks/line
https://YOUR_DOMAIN/webhooks/x
https://YOUR_DOMAIN/webhooks/tiktok
```

Signature verification is implemented per platform (Meta `X-Hub-Signature-256`,
LINE `X-Line-Signature`, X CRC/`X-Twitter-Webhooks-Signature`, TikTok HMAC).

---

## 🔐 Roles & permissions

| Role | Reply | Assign | Takeover | View all | Round-robin owner |
|---|:--:|:--:|:--:|:--:|:--:|
| Owner | ✅ | ✅ | ✅ | ✅ | ❌ |
| Admin | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manager | ✅ | ✅ | ✅ | ✅ | ❌ |
| Supervisor | ✅ | ✅ | ✅ | team only | ❌ (except keyword override) |
| Sales Agent | ✅ | ❌ | ❌ | own only | ✅ |
| Viewer / Observer | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## 🗄️ Data model

`organizations, users, teams, team_members, channel_accounts, routing_rules,
conversations, messages, conversation_assignments (round_robin|manual|ai|transfer),
notifications`.

## 🔑 API (selected)

All `/api/*` routes require an `X-User-Id` header (demo-grade auth — replace with
real sessions/JWT in production).

```
GET  /api/me · /api/meta · /api/users · /api/teams
GET  /api/channel-accounts · POST /api/channel-accounts
GET  /api/routing-rules · POST /api/routing-rules
GET  /api/inbox?mode=my|team|unassigned|all
GET  /api/conversations/:id
POST /api/conversations/:id/reply · /assign · /transfer · /takeover · /read
GET  /api/notifications
WS   /ws?userId=...
```
