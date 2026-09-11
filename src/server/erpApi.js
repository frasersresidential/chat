import express from 'express';
import { db } from '../store/db.js';
import { can, PERMISSIONS } from '../core/rbac.js';
import { orgErpSettings, sanitizeErpSettings } from '../erp/settings.js';
import { calcJobItem, docTotals } from '../erp/pricing.js';
import { sanitizeMaterial, recordMove, rollSqm, lowStockList } from '../erp/stock.js';
import {
  ORDER_STATUSES, ORDER_STATUS_LABEL, QUOTE_STATUSES,
  createQuote, updateQuote, convertQuoteToOrder, setOrderStatus, recordPayment, issueDocument,
} from '../erp/orders.js';
import { logger } from '../logger.js';

const log = logger('erp-api');

/**
 * REST surface for the print-shop ERP, mounted under /api/erp (auth applied by
 * app.js). Working the shop (quotes, jobs, stock in/out) needs REPLY (staff);
 * settings / price rates / material master / adjustments need MANAGE_ERP
 * (owner, admin, manager).
 */
export function createErpRouter() {
  const erp = express.Router();

  const canUse = (req, res, next) =>
    (can(req.user, PERMISSIONS.REPLY) || can(req.user, PERMISSIONS.MANAGE_ERP))
      ? next() : res.status(403).json({ error: 'ต้องเป็นพนักงานที่มีสิทธิ์ใช้งาน' });
  const canManage = (req, res, next) =>
    can(req.user, PERMISSIONS.MANAGE_ERP)
      ? next() : res.status(403).json({ error: 'ต้องมีสิทธิ์ Manage ERP (Owner/Admin/Manager)' });

  const orgOf = (req) => req.user.organizationId;
  const decorateMaterial = (m) => ({
    ...m,
    rollSqm: rollSqm(m),
    low: m.reorderPoint > 0 && (m.stockQty ?? 0) <= m.reorderPoint,
  });

  // ── Bootstrap (everything the SPA needs on load) ──────────────────────────
  erp.get('/bootstrap', canUse, (req, res) => {
    const O = orgOf(req);
    res.json({
      settings: orgErpSettings(O),
      customers: db.erpCustomers.filter((c) => c.organizationId === O),
      materials: db.erpMaterials.filter((m) => m.organizationId === O).map(decorateMaterial),
      dies: db.erpDies.filter((d) => d.organizationId === O),
      orderStatuses: ORDER_STATUSES,
      orderStatusLabels: ORDER_STATUS_LABEL,
      quoteStatuses: QUOTE_STATUSES,
      canManage: can(req.user, PERMISSIONS.MANAGE_ERP),
      me: { id: req.user.id, name: req.user.name, role: req.user.role },
    });
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  erp.get('/dashboard', canUse, (req, res) => {
    const O = orgOf(req);
    const orders = db.erpOrders.filter((o) => o.organizationId === O);
    const monthKey = new Date().toISOString().slice(0, 7);
    const dayKey = new Date().toISOString().slice(0, 10);
    let salesMonth = 0, salesToday = 0;
    for (const o of orders) {
      for (const p of o.payments || []) {
        if ((p.at || '').startsWith(monthKey)) salesMonth += p.amount;
        if ((p.at || '').startsWith(dayKey)) salesToday += p.amount;
      }
    }
    const active = orders.filter((o) => !['done', 'cancelled'].includes(o.status));
    const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    const soon = Date.now() + 2 * 86400000;
    res.json({
      salesMonth: Math.round(salesMonth * 100) / 100,
      salesToday: Math.round(salesToday * 100) / 100,
      activeJobs: active.length,
      unpaidTotal: Math.round(orders.filter((o) => o.status !== 'cancelled')
        .reduce((s, o) => s + Math.max(0, (o.grandTotal || 0) - (o.paidAmount || 0)), 0) * 100) / 100,
      byStatus,
      dueSoon: active
        .filter((o) => o.dueDate && new Date(o.dueDate).getTime() <= soon)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
        .slice(0, 10),
      lowStock: lowStockList(O).map(decorateMaterial),
      recentQuotes: db.erpQuotes.filter((q) => q.organizationId === O)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    });
  });

  // ── Price calculator (preview, ไม่บันทึก) ─────────────────────────────────
  erp.post('/calc', canUse, (req, res) => {
    try {
      res.json(calcJobItem(orgOf(req), req.body.spec || req.body, { tier: req.body.tier || 'retail' }));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Customers ─────────────────────────────────────────────────────────────
  erp.post('/customers', canUse, (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อลูกค้า' });
    res.status(201).json(db.erpCustomers.insert({
      organizationId: orgOf(req), name: name.slice(0, 200),
      tier: ['retail', 'wholesale', 'vip'].includes(req.body.tier) ? req.body.tier : 'retail',
      phone: String(req.body.phone || '').slice(0, 60), email: String(req.body.email || '').slice(0, 120),
      taxId: String(req.body.taxId || '').slice(0, 20), address: String(req.body.address || '').slice(0, 500),
      note: String(req.body.note || '').slice(0, 500),
    }));
  });
  erp.put('/customers/:id', canUse, (req, res) => {
    const c = db.erpCustomers.get(req.params.id);
    if (!c || c.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    const patch = {};
    for (const k of ['name', 'phone', 'email', 'taxId', 'address', 'note']) {
      if (req.body[k] !== undefined) patch[k] = String(req.body[k]).slice(0, 500);
    }
    if (['retail', 'wholesale', 'vip'].includes(req.body.tier)) patch.tier = req.body.tier;
    res.json(db.erpCustomers.update(c.id, patch));
  });

  /** Find-or-create an ERP customer from a chat conversation (quote-from-chat). */
  erp.post('/customers/from-conversation', canUse, (req, res) => {
    const conv = db.conversations.get(req.body.conversationId);
    if (!conv || conv.organizationId !== orgOf(req)) return res.status(404).json({ error: 'ไม่พบแชตนี้' });
    let customer = db.erpCustomers.find((c) => c.organizationId === orgOf(req) && c.conversationId === conv.id);
    if (!customer) {
      customer = db.erpCustomers.insert({
        organizationId: orgOf(req),
        name: conv.customer?.name || 'ลูกค้าจากแชต',
        tier: conv.customer?.vip ? 'vip' : 'retail',
        phone: '', email: '', taxId: '', address: '',
        note: `สร้างจากแชต (${conv.channel})`,
        conversationId: conv.id,
      });
    }
    res.json({ customer, conversationId: conv.id });
  });

  // ── Dies (บล็อกไดคัทของลูกค้า) ────────────────────────────────────────────
  erp.post('/dies', canUse, (req, res) => {
    const customer = db.erpCustomers.get(req.body.customerId);
    if (!customer || customer.organizationId !== orgOf(req)) return res.status(400).json({ error: 'ต้องเลือกลูกค้า' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อบล็อก' });
    res.status(201).json(db.erpDies.insert({
      organizationId: orgOf(req), customerId: customer.id, name: name.slice(0, 200),
      sizeSpec: String(req.body.sizeSpec || '').slice(0, 120),
      location: String(req.body.location || '').slice(0, 120),
      note: String(req.body.note || '').slice(0, 300),
    }));
  });

  // ── Materials & stock ─────────────────────────────────────────────────────
  erp.post('/materials', canManage, (req, res) => {
    const m = sanitizeMaterial(req.body);
    if (!m.name) return res.status(400).json({ error: 'ต้องระบุชื่อวัสดุ' });
    res.status(201).json(decorateMaterial(db.erpMaterials.insert({
      organizationId: orgOf(req), stockQty: Math.max(0, Number(req.body.stockQty) || 0),
      lowStockAlertedAt: null, ...m,
    })));
  });
  erp.put('/materials/:id', canManage, (req, res) => {
    const cur = db.erpMaterials.get(req.params.id);
    if (!cur || cur.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    res.json(decorateMaterial(db.erpMaterials.update(cur.id, sanitizeMaterial(req.body, cur))));
  });

  // รับของเข้า: ระบุเป็นจำนวนม้วน (แปลงเป็น ตร.ม. ให้) หรือจำนวนหน่วยตรง ๆ
  erp.post('/stock/in', canUse, (req, res) => {
    const material = db.erpMaterials.get(req.body.materialId);
    if (!material || material.organizationId !== orgOf(req)) return res.status(404).json({ error: 'ไม่พบวัสดุ' });
    let qty = Number(req.body.qty);
    if (req.body.rolls != null) {
      const perRoll = rollSqm(material);
      if (!perRoll) return res.status(400).json({ error: 'วัสดุนี้ไม่มีขนาดม้วน — กรอกจำนวนหน่วยตรง ๆ แทน' });
      qty = Number(req.body.rolls) * perRoll;
    }
    try {
      const move = recordMove(material, {
        type: 'in', qty,
        unitCost: req.body.unitCost != null && req.body.unitCost !== '' ? Number(req.body.unitCost) : null,
        refType: 'purchase', note: req.body.note || '', byUserId: req.user.id,
      });
      res.status(201).json({ move, material: decorateMaterial(db.erpMaterials.get(material.id)) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  erp.post('/stock/adjust', canManage, (req, res) => {
    const material = db.erpMaterials.get(req.body.materialId);
    if (!material || material.organizationId !== orgOf(req)) return res.status(404).json({ error: 'ไม่พบวัสดุ' });
    try {
      const move = recordMove(material, {
        type: 'adjust', qty: Number(req.body.qty),
        refType: 'manual', note: req.body.note || 'ปรับยอดจากการนับสต๊อก', byUserId: req.user.id,
      });
      res.status(201).json({ move, material: decorateMaterial(db.erpMaterials.get(material.id)) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  erp.get('/stock/moves', canUse, (req, res) => {
    let rows = db.erpStockMoves.filter((m) => m.organizationId === orgOf(req));
    if (req.query.materialId) rows = rows.filter((m) => m.materialId === req.query.materialId);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows.slice(0, Math.min(300, Number(req.query.limit) || 100)));
  });

  // ── Quotes ────────────────────────────────────────────────────────────────
  erp.get('/quotes', canUse, (req, res) => {
    let rows = db.erpQuotes.filter((q) => q.organizationId === orgOf(req));
    if (req.query.status) rows = rows.filter((q) => q.status === req.query.status);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows.slice(0, 200));
  });
  erp.get('/quotes/:id', canUse, (req, res) => {
    const q = db.erpQuotes.get(req.params.id);
    if (!q || q.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    res.json({ quote: q, customer: db.erpCustomers.get(q.customerId), settings: orgErpSettings(orgOf(req)) });
  });
  erp.post('/quotes', canUse, (req, res) => {
    try { res.status(201).json(createQuote(orgOf(req), req.user, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  erp.put('/quotes/:id', canUse, (req, res) => {
    const q = db.erpQuotes.get(req.params.id);
    if (!q || q.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    try { res.json(updateQuote(q, req.user, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  erp.post('/quotes/:id/convert', canUse, (req, res) => {
    const q = db.erpQuotes.get(req.params.id);
    if (!q || q.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    try { res.status(201).json(convertQuoteToOrder(q, req.user, { dueDate: req.body.dueDate || null })); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Orders (ใบงาน) ───────────────────────────────────────────────────────
  erp.get('/orders', canUse, (req, res) => {
    let rows = db.erpOrders.filter((o) => o.organizationId === orgOf(req));
    if (req.query.status) rows = rows.filter((o) => o.status === req.query.status);
    if (req.query.active === '1') rows = rows.filter((o) => !['done', 'cancelled'].includes(o.status));
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) rows = rows.filter((o) => o.number.toLowerCase().includes(q) || (o.customerName || '').toLowerCase().includes(q));
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows.slice(0, 300));
  });
  erp.get('/orders/:id', canUse, (req, res) => {
    const o = db.erpOrders.get(req.params.id);
    if (!o || o.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    res.json({
      order: o,
      customer: db.erpCustomers.get(o.customerId),
      docs: db.erpInvoices.filter((d) => d.orderId === o.id),
      settings: orgErpSettings(orgOf(req)),
    });
  });
  erp.post('/orders/:id/status', canUse, async (req, res) => {
    const o = db.erpOrders.get(req.params.id);
    if (!o || o.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    try { res.json(await setOrderStatus(o.id, req.user, req.body.status, { note: req.body.note })); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  erp.put('/orders/:id', canUse, (req, res) => {
    const o = db.erpOrders.get(req.params.id);
    if (!o || o.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.dueDate !== undefined) patch.dueDate = req.body.dueDate || null;
    if (['normal', 'rush'].includes(req.body.priority)) patch.priority = req.body.priority;
    if (req.body.notifyCustomer !== undefined) patch.notifyCustomer = !!req.body.notifyCustomer;
    if (req.body.shipping && typeof req.body.shipping === 'object') {
      patch.shipping = {
        method: String(req.body.shipping.method ?? o.shipping.method ?? '').slice(0, 60),
        trackingNo: String(req.body.shipping.trackingNo ?? o.shipping.trackingNo ?? '').slice(0, 60),
        address: String(req.body.shipping.address ?? o.shipping.address ?? '').slice(0, 500),
      };
    }
    if (req.body.conversationId !== undefined) {
      const conv = req.body.conversationId ? db.conversations.get(req.body.conversationId) : null;
      if (req.body.conversationId && (!conv || conv.organizationId !== orgOf(req))) {
        return res.status(400).json({ error: 'ไม่พบแชตที่ระบุ' });
      }
      patch.conversationId = conv ? conv.id : null;
    }
    res.json(db.erpOrders.update(o.id, patch));
  });
  erp.post('/orders/:id/payments', canUse, (req, res) => {
    const o = db.erpOrders.get(req.params.id);
    if (!o || o.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    try { res.status(201).json(recordPayment(o.id, req.user, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  erp.post('/orders/:id/docs', canUse, (req, res) => {
    const o = db.erpOrders.get(req.params.id);
    if (!o || o.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    try { res.status(201).json(issueDocument(o, req.user, req.body.type)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  erp.get('/docs/:id', canUse, (req, res) => {
    const d = db.erpInvoices.get(req.params.id);
    if (!d || d.organizationId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
    res.json({
      doc: d,
      order: db.erpOrders.get(d.orderId),
      customer: db.erpCustomers.get(d.customerId),
      settings: orgErpSettings(orgOf(req)),
    });
  });

  // ── Settings ──────────────────────────────────────────────────────────────
  erp.get('/settings', canUse, (req, res) => res.json(orgErpSettings(orgOf(req))));
  erp.put('/settings', canManage, (req, res) => {
    const org = db.organizations.get(orgOf(req));
    const next = sanitizeErpSettings(req.body, orgErpSettings(org));
    db.organizations.update(org.id, { erp: next });
    log.info(`ERP settings updated by ${req.user.name}`);
    res.json(next);
  });

  return erp;
}
