/**
 * Prospect Scoring — a standalone CRM analytics app.
 *
 * Same scoring engine as OmniChat (src/core/leadScoring + leads + xlsx) but a
 * self-contained server + UI with its own login and its own deploy/URL. It does
 * NOT seed or serve any chat data — purely import → score → rank prospects.
 *
 *   PROSPECT_PASSWORD  login password (default "demo1234")
 *   AUTH_SECRET        token signing secret
 *   DATABASE_URL       optional Postgres for durable storage
 *   PORT               default 3100
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/store/db.js';
import { signToken, verifyToken } from '../src/core/auth.js';
import { importLeads, listLeads, getLead, leadsSummary, clearLeads, exportLeadsCSV } from '../src/core/leads.js';
import { logger } from '../src/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger('prospect');

// Single-tenant: every lead lives under one workspace id.
const ORG = 'default';
const PASSWORD = process.env.PROSPECT_PASSWORD || 'demo1234';

function auth(req, res, next) {
  const token = (req.header('authorization') || '').replace(/^Bearer /, '');
  const payload = verifyToken(token);
  if (!payload || payload.app !== 'prospect') return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function createProspectApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Auth ──────────────────────────────────────────────────────────────────
  app.post('/api/login', express.json(), (req, res) => {
    if (String(req.body?.password || '') !== PASSWORD) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }
    res.json({ token: signToken({ app: 'prospect' }) });
  });

  const api = express.Router();
  api.use(auth);

  api.get('/leads', (req, res) => {
    res.json({
      summary: leadsSummary(ORG),
      leads: listLeads(ORG, {
        tier: req.query.tier || null,
        project: req.query.project || null,
        q: req.query.q || null,
        minScore: req.query.minScore ? Number(req.query.minScore) : null,
      }),
    });
  });

  api.get('/leads/export', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
    res.send(exportLeadsCSV(ORG, { tier: req.query.tier || null, project: req.query.project || null }));
  });

  api.get('/leads/:id', (req, res) => {
    const lead = getLead(ORG, req.params.id);
    if (!lead) return res.status(404).json({ error: 'not found' });
    res.json(lead);
  });

  api.post('/leads/import', express.raw({ type: '*/*', limit: '26214400' }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'empty upload' });
    let filename = 'import.xlsx';
    try { filename = decodeURIComponent(req.header('x-file-name') || filename); } catch { /* keep default */ }
    try {
      res.status(201).json(importLeads(ORG, req.body, filename));
    } catch (e) {
      log.error(`import failed: ${e.message}`);
      res.status(400).json({ error: e.message });
    }
  });

  api.delete('/leads', (req, res) => res.json(clearLeads(ORG)));

  app.use('/api', api);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  return app;
}

// Boot when run directly (node prospect-app/server.js).
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  await db.init(); // optional Postgres; otherwise the JSON file store
  const port = Number(process.env.PORT || 3100);
  createProspectApp().listen(port, () => log.info(`Prospect Scoring → http://localhost:${port}`));
}
