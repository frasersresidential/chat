import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from './store.js';
import { config } from './config.js';
import { vapidPublicKey, saveSubscription, pushEnabled } from './push.js';
import {
  liveEnabled, listCompetitors, addCompetitor, updateCompetitor, removeCompetitor,
  refreshCompetitor, refreshAll, listAds, winningAds, toggleSaved, insights,
  snapshotRenderUrl,
} from './core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Demo-grade auth: one shared dashboard password (ADSPY_PASSWORD). Login trades
 * it for a static HMAC token; every /api route requires that bearer token.
 */
const sessionToken = () =>
  crypto.createHmac('sha256', config.authSecret).update(config.password).digest('hex');

function authMiddleware(req, res, next) {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !crypto.timingSafeEqual(Buffer.from(token.padEnd(64).slice(0, 64)), Buffer.from(sessionToken()))) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.post('/api/login', (req, res) => {
    if (String(req.body.password || '') !== config.password) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    res.json({ token: sessionToken() });
  });

  const api = express.Router();
  api.use(authMiddleware);

  api.get('/config', (_req, res) => {
    res.json({ live: liveEnabled(), defaultCountry: config.defaultCountry, pushEnabled: pushEnabled() });
  });

  // ── Watchlist ─────────────────────────────────────────────────────────────
  api.get('/competitors', (_req, res) => res.json(listCompetitors()));

  api.post('/competitors', async (req, res) => {
    try {
      const c = addCompetitor(req.body);
      await refreshCompetitor(c); // populate immediately so the row isn't empty
      res.status(201).json(listCompetitors().find((x) => x.id === c.id));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  const ownCompetitor = (req, res) => {
    const c = db.competitors.get(req.params.id);
    if (!c) { res.status(404).json({ error: 'not found' }); return null; }
    return c;
  };

  api.put('/competitors/:id', (req, res) => {
    const c = ownCompetitor(req, res); if (!c) return;
    res.json(updateCompetitor(c, req.body));
  });
  api.delete('/competitors/:id', (req, res) => {
    const c = ownCompetitor(req, res); if (!c) return;
    removeCompetitor(c);
    res.status(204).end();
  });
  api.post('/competitors/:id/refresh', async (req, res) => {
    const c = ownCompetitor(req, res); if (!c) return;
    const { newAds, error } = await refreshCompetitor(c);
    res.json({ newAds: newAds.length, error });
  });
  api.post('/refresh', async (_req, res) => {
    const results = await refreshAll();
    res.json({ competitors: results.length, newAds: results.reduce((s, r) => s + r.newAds.length, 0) });
  });

  // ── Ads / swipe file / insights ───────────────────────────────────────────
  api.get('/ads', (req, res) => {
    res.json(listAds({
      competitorId: req.query.competitorId, status: req.query.status,
      saved: req.query.saved, q: req.query.q, sort: req.query.sort,
    }));
  });
  api.get('/winning', (req, res) => res.json(winningAds(Number(req.query.limit) || 24)));
  api.get('/insights', (req, res) => res.json(insights(req.query.competitorId || null)));
  api.post('/ads/:id/save', (req, res) => {
    const ad = db.ads.get(req.params.id);
    if (!ad) return res.status(404).json({ error: 'not found' });
    res.json(toggleSaved(ad, { saved: req.body.saved, tags: req.body.tags }));
  });

  // ── Real-creative snapshot proxy ──────────────────────────────────────────
  // Loaded in an <iframe>, which cannot send an Authorization header, so this
  // route sits outside the bearer router and authenticates via ?t=<session
  // token> instead. LIVE: redirect to Meta's official render_ad preview (the
  // access token is appended server-side and never stored or sent to the SPA).
  // MOCK: serve a styled placeholder so the preview flow is testable offline.
  app.get('/api/ads/:id/snapshot', (req, res) => {
    const t = String(req.query.t || '');
    if (t !== sessionToken()) return res.status(401).send('unauthorized');
    const ad = db.ads.get(req.params.id);
    if (!ad) return res.status(404).send('not found');
    const render = snapshotRenderUrl(ad);
    if (render) return res.redirect(render);
    const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/></head>
      <body style="margin:0;font-family:-apple-system,'Noto Sans Thai',sans-serif;background:#fff;color:#1c1e21">
        <div style="max-width:420px;margin:0 auto;border:1px solid #dadde1">
          <div style="padding:10px 12px;font-weight:700">${escapeHtml(ad.pageName)} <span style="color:#65676b;font-weight:400;font-size:12px">· Sponsored (ตัวอย่างจำลอง)</span></div>
          <div style="padding:0 12px 10px;font-size:14px;line-height:1.5">${escapeHtml(ad.body)}</div>
          <div style="height:230px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;background:linear-gradient(135deg,${escapeHtml(ad.imageColor || '#1f6feb')},#111)">${escapeHtml(ad.headline)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f0f2f5">
            <span style="font-size:13px;color:#65676b">ในโหมด LIVE ตรงนี้คือครีเอทีฟจริงจาก Meta</span>
            <span style="border:1px solid #ccd0d5;border-radius:6px;padding:6px 12px;font-weight:600;font-size:13px">${escapeHtml(ad.cta)}</span>
          </div>
        </div>
      </body></html>`);
  });

  // ── Web Push ──────────────────────────────────────────────────────────────
  api.get('/push/key', (_req, res) => res.json({ key: vapidPublicKey(), enabled: pushEnabled() }));
  api.post('/push/subscribe', (req, res) => {
    try { res.status(201).json({ ok: true, id: saveSubscription(req.body.subscription)?.id }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.use('/api', api);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  return app;
}
