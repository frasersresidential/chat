import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../store/db.js';
import { can, PERMISSIONS, ROLES } from '../core/rbac.js';
import { verifyToken, signToken, verifyPassword } from '../core/auth.js';
import {
  draw as gameDraw, publicCampaign, remainingToday, campaignStats, campaignReport,
  sanitizeCampaign, THEME_PRESETS, enterGate as gameEnter, hasEntered as gameHasEntered,
} from '../core/games.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger('studio');

// Studio shares the same upload bucket as the main app (served at /uploads).
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
};

/** Resolve the acting user from a Bearer JWT. */
function authMiddleware(req, res, next) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  const user = payload ? db.users.get(payload.sub) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (user.status === 'disabled') return res.status(403).json({ error: 'account disabled' });
  req.user = user;
  next();
}

const requirePerm = (perm) => (req, res, next) => {
  if (!can(req.user, perm)) return res.status(403).json({ error: `missing permission: ${perm}` });
  next();
};

function publicUser(u) {
  if (!u) return u;
  const { passwordHash, ...safe } = u;
  return safe;
}

/**
 * Gamification Studio — a standalone admin tool for the lucky-draw games,
 * fully separate from the OmniChat inbox. It serves:
 *   • the customer game page      → /games.html?c=<campaignId>  + /api/play/*
 *   • the admin console (Games + Reports) → /  (studio.html)   + /api/games/*
 * It reuses the same auth accounts and the same game engine (core/games.js).
 */
export function createStudioApp() {
  const app = express();

  app.use(express.json());
  // Studio's own front-end is studio.html; expose it at the root.
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'studio.html')));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // ── Auth (reuses OmniChat accounts) ───────────────────────────────────────
  const auth = express.Router();
  auth.post('/login', (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    const user = db.users.find((u) => (u.email || '').toLowerCase() === email);
    if (!user || !verifyPassword(req.body.password, user.passwordHash)) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    if (user.status === 'disabled') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับ' });
    res.json({ token: signToken({ sub: user.id }), user: publicUser(user) });
  });
  app.use('/api/auth', auth);

  // ── Public lucky-draw games (no token — customers open /games.html) ───────
  const play = express.Router();
  play.get('/:id', (req, res) => {
    const campaign = db.gameCampaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not found' });
    const view = publicCampaign(campaign);
    const playerId = String(req.query.player || '');
    res.json({
      ...view,
      remainingToday: playerId ? remainingToday(campaign, playerId) : view.limitPerDay,
      entered: playerId ? gameHasEntered(campaign.id, playerId) : false,
    });
  });
  play.post('/:id/enter', (req, res) => {
    const campaign = db.gameCampaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not found' });
    const result = gameEnter({
      campaign, playerId: String(req.body.playerId || ''),
      name: req.body.name, phone: req.body.phone, project: req.body.project, plot: req.body.plot, code: req.body.code,
    });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });
  play.post('/:id/draw', (req, res) => {
    const campaign = db.gameCampaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not found' });
    const result = gameDraw({ campaign, playerId: String(req.body.playerId || ''), game: String(req.body.game || '') });
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });
  app.use('/api/play', play);

  // ── Admin API (token required) ────────────────────────────────────────────
  const api = express.Router();
  api.use(authMiddleware);

  api.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user), permissions: ROLES[req.user.role]?.permissions || [] });
  });

  // Image uploads for campaign banners.
  api.post('/uploads', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), express.raw({ type: '*/*', limit: '26214400' }), (req, res) => {
    const mime = req.header('content-type') || 'application/octet-stream';
    const ext = MIME_EXT[mime] || '';
    if (!ext) return res.status(415).json({ error: 'รองรับเฉพาะรูปภาพ PNG/JPG/WebP/GIF' });
    const origName = decodeURIComponent(req.header('x-file-name') || 'banner');
    const fileName = `banner_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), req.body);
    res.status(201).json({ url: `/uploads/${fileName}`, mime, name: origName });
  });

  // ── Games ────────────────────────────────────────────────────────────────
  api.get('/games/presets', (_req, res) => res.json(THEME_PRESETS));
  api.get('/games/campaigns', (req, res) => {
    res.json(db.gameCampaigns.filter((c) => c.organizationId === req.user.organizationId)
      .map((c) => ({ ...c, stats: campaignStats(c.id) })));
  });
  api.post('/games/campaigns', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    res.status(201).json(db.gameCampaigns.insert(sanitizeCampaign(req.body, req.user.organizationId)));
  });
  api.post('/games/campaigns/:id', requirePerm(PERMISSIONS.MANAGE_AUTOMATION), (req, res) => {
    const cur = db.gameCampaigns.get(req.params.id);
    if (!cur || cur.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json(db.gameCampaigns.update(cur.id, sanitizeCampaign(req.body, cur.organizationId, cur)));
  });

  // ── Reports (registrants + prizes won) ─────────────────────────────────────
  api.get('/games/campaigns/:id/report', (req, res) => {
    const cur = db.gameCampaigns.get(req.params.id);
    if (!cur || cur.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    res.json({ stats: campaignStats(cur.id), rows: campaignReport(cur) });
  });
  api.get('/games/campaigns/:id/report.csv', (req, res) => {
    const cur = db.gameCampaigns.get(req.params.id);
    if (!cur || cur.organizationId !== req.user.organizationId) return res.status(404).send('not found');
    const rows = campaignReport(cur);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['เวลาที่ลงทะเบียน', 'ชื่อ-นามสกุล', 'เบอร์โทร', 'โครงการ', 'แปลง/ยูนิต', 'เล่นแล้ว', 'เกม', 'รางวัลที่ได้', 'ถูกรางวัล', 'โค้ด'];
    const lines = [header.map(esc).join(',')];
    for (const r of rows) {
      lines.push([
        r.registeredAt, r.name, r.phone, r.project, r.plot,
        r.played ? 'เล่นแล้ว' : 'ยังไม่ได้เล่น',
        r.game || '', r.prize || '', r.win == null ? '' : (r.win ? 'ได้รางวัล' : 'ไม่ได้รางวัล'), r.couponCode || '',
      ].map(esc).join(','));
    }
    const csv = '﻿' + lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${cur.id}.csv"`);
    res.send(csv);
  });

  app.use('/api', api);

  app.get('/healthz', (_req, res) => res.json({ ok: true, app: 'studio' }));

  return app;
}
