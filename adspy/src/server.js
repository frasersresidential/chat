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
