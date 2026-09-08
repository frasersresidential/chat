import express from 'express';
import { db } from '../store/db.js';
import { can, PERMISSIONS } from '../core/rbac.js';
import { AD_PLATFORMS } from '../ads/providers/index.js';
import { kpisOf, todayTotals, orgHourlySeries, orgTodayKpis } from '../ads/engine.js';
import {
  orgAdsPolicy, sanitizeAdsPolicy, runAdsCycle, resolveSuggestion, manualAction,
} from '../ads/optimizer.js';
import { analyzePortfolio, claudeEnabled } from '../ads/ai.js';
import { logger } from '../logger.js';

const log = logger('ads-api');

/**
 * REST surface for the AI ads optimization module. Mounted under /api/ads by
 * app.js (auth middleware already applied there).
 *
 * Viewing needs VIEW_ANALYTICS; anything that changes money needs MANAGE_ADS.
 */
export function createAdsRouter() {
  const ads = express.Router();

  const canView = (req, res, next) =>
    (can(req.user, PERMISSIONS.VIEW_ANALYTICS) || can(req.user, PERMISSIONS.MANAGE_ADS))
      ? next() : res.status(403).json({ error: 'ต้องมีสิทธิ์ดู Analytics' });
  const canManage = (req, res, next) =>
    can(req.user, PERMISSIONS.MANAGE_ADS)
      ? next() : res.status(403).json({ error: 'ต้องมีสิทธิ์ Manage Ads (Owner/Admin)' });

  const redact = (cred = {}) =>
    Object.fromEntries(Object.keys(cred).map((k) => [k, cred[k] ? '••••configured' : '']));
  const publicAccount = (a) => ({
    ...a,
    credential: redact(a.credential),
    simulated: !Object.values(a.credential || {}).some(Boolean),
  });

  /** Flat entity list (campaign → adset → ad order) decorated with KPIs. */
  function entityRows(orgId, accountId = null) {
    const accounts = db.adAccounts.filter((a) => a.organizationId === orgId && (!accountId || a.id === accountId));
    const rows = [];
    for (const account of accounts) {
      const all = db.adEntities.filter((e) => e.accountId === account.id);
      const decorate = (e, depth) => ({
        id: e.id, accountId: account.id, platform: account.platform, level: e.level, depth,
        parentId: e.parentId, name: e.name, status: e.status,
        dailyBudget: e.dailyBudget, bid: e.bid,
        aiExcluded: !!e.aiExcluded, aiPausedBy: e.ai?.pausedBy || null,
        kpis: kpisOf(todayTotals(e, all)),
      });
      const walk = (parentId, depth) => {
        const children = all
          .filter((e) => e.parentId === parentId)
          .map((e) => ({ e, spend: todayTotals(e, all).spend }))
          .sort((a, b) => b.spend - a.spend);
        for (const { e } of children) {
          rows.push(decorate(e, depth));
          walk(e.id, depth + 1);
        }
      };
      walk(null, 0);
    }
    return rows;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  ads.get('/overview', canView, (req, res) => {
    const orgId = req.user.organizationId;
    const actions = db.adActions
      .filter((a) => a.organizationId === orgId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({
      platforms: AD_PLATFORMS,
      accounts: db.adAccounts.filter((a) => a.organizationId === orgId).map(publicAccount),
      totals: orgTodayKpis(orgId),
      series: orgHourlySeries(orgId, 12),
      entities: entityRows(orgId),
      actions: actions.slice(0, 40),
      pendingSuggestions: actions.filter((a) => a.status === 'suggested').length,
      policy: orgAdsPolicy(db.organizations.get(orgId)),
      ai: { claude: claudeEnabled() },
      canManage: can(req.user, PERMISSIONS.MANAGE_ADS),
    });
  });

  ads.get('/entities', canView, (req, res) => {
    res.json(entityRows(req.user.organizationId, req.query.accountId || null));
  });

  ads.get('/actions', canView, (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 60);
    let rows = db.adActions.filter((a) => a.organizationId === req.user.organizationId);
    if (req.query.status) rows = rows.filter((a) => a.status === req.query.status);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows.slice(0, limit));
  });

  // ── Ad accounts ───────────────────────────────────────────────────────────
  ads.post('/accounts', canManage, (req, res) => {
    const { platform, name, credential } = req.body;
    if (!AD_PLATFORMS[platform] || !String(name || '').trim()) {
      return res.status(400).json({ error: 'ต้องระบุ platform (meta/google) และชื่อบัญชี' });
    }
    const acc = db.adAccounts.insert({
      organizationId: req.user.organizationId,
      platform, name: String(name).trim(),
      credential: credential && typeof credential === 'object' ? credential : {},
      status: 'active', currency: 'THB',
    });
    res.status(201).json(publicAccount(acc));
  });

  ads.put('/accounts/:id', canManage, (req, res) => {
    const acc = db.adAccounts.get(req.params.id);
    if (!acc || acc.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.name) patch.name = String(req.body.name).trim();
    if (['active', 'paused'].includes(req.body.status)) patch.status = req.body.status;
    if (req.body.credential && typeof req.body.credential === 'object') {
      // Write-only merge — blank fields keep their existing secret.
      const incoming = Object.fromEntries(Object.entries(req.body.credential).filter(([, v]) => String(v || '').trim()));
      patch.credential = { ...acc.credential, ...incoming };
    }
    res.json(publicAccount(db.adAccounts.update(acc.id, patch)));
  });

  ads.delete('/accounts/:id', canManage, (req, res) => {
    const acc = db.adAccounts.get(req.params.id);
    if (!acc || acc.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    // Cascade: entities + their metrics; keep the action log (it's an audit trail).
    for (const e of db.adEntities.filter((x) => x.accountId === acc.id)) {
      db.adMetrics.remove(e.id);
      db.adEntities.remove(e.id);
    }
    db.adAccounts.remove(acc.id);
    res.status(204).end();
  });

  // ── Manual control + AI opt-out per entity ────────────────────────────────
  ads.post('/entities/:id/action', canManage, async (req, res) => {
    const entity = db.adEntities.get(req.params.id);
    if (!entity || entity.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const kind = req.body.kind;
    if (!['pause', 'resume', 'budget', 'bid'].includes(kind)) return res.status(400).json({ error: 'invalid kind' });
    try {
      const action = await manualAction(req.user, entity, { kind, value: Number(req.body.value) });
      res.json(action);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  ads.put('/entities/:id', canManage, (req, res) => {
    const entity = db.adEntities.get(req.params.id);
    if (!entity || entity.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.aiExcluded !== undefined) patch.aiExcluded = !!req.body.aiExcluded;
    res.json(db.adEntities.update(entity.id, patch));
  });

  // ── Approval queue (suggest mode) ─────────────────────────────────────────
  ads.post('/actions/:id/approve', canManage, async (req, res) => {
    try {
      const a = db.adActions.get(req.params.id);
      if (!a || a.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
      res.json(await resolveSuggestion(a.id, req.user, true));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  ads.post('/actions/:id/reject', canManage, async (req, res) => {
    try {
      const a = db.adActions.get(req.params.id);
      if (!a || a.organizationId !== req.user.organizationId) return res.status(404).json({ error: 'not found' });
      res.json(await resolveSuggestion(a.id, req.user, false));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Optimization policy ───────────────────────────────────────────────────
  ads.get('/policy', canView, (req, res) => {
    res.json(orgAdsPolicy(db.organizations.get(req.user.organizationId)));
  });
  ads.put('/policy', canManage, (req, res) => {
    const org = db.organizations.get(req.user.organizationId);
    const policy = sanitizeAdsPolicy(req.body, orgAdsPolicy(org));
    db.organizations.update(org.id, { adsPolicy: policy });
    res.json(policy);
  });

  // ── Run now + Claude analysis ─────────────────────────────────────────────
  ads.post('/run', canManage, async (req, res) => {
    try {
      const org = db.organizations.get(req.user.organizationId);
      const result = await runAdsCycle(org);
      res.json({ ok: true, actions: (result.actions || []).length });
    } catch (e) {
      log.error(e.message);
      res.status(500).json({ error: e.message });
    }
  });

  ads.post('/analyze', canManage, async (req, res) => {
    try {
      res.json(await analyzePortfolio(db.organizations.get(req.user.organizationId)));
    } catch (e) {
      log.error(e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return ads;
}
