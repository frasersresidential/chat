import { db } from '../store/db.js';
import { bus } from '../core/eventBus.js';
import { notify } from '../core/notifications.js';
import { can, PERMISSIONS } from '../core/rbac.js';
import { logger } from '../logger.js';

const log = logger('erp-stock');

/**
 * Raw-material stock for a print shop. Roll materials (สติกเกอร์/ลามิเนต) are
 * bought as rolls but consumed by area, so the base unit is ตร.ม. (sqm) with a
 * roll-size hint (rollWidthCm × rollLengthM) used for display ("≈ 3.2 ม้วน")
 * and for the stock-in form. Every movement is journaled in erpStockMoves;
 * average cost updates on stock-in.
 */
export const MATERIAL_CATEGORIES = ['sticker', 'laminate', 'ink', 'core', 'packaging', 'other'];
export const MATERIAL_UNITS = ['sqm', 'pcs', 'roll', 'liter'];

const round2 = (n) => Math.round(n * 100) / 100;

export const rollSqm = (m) =>
  m.rollWidthCm > 0 && m.rollLengthM > 0 ? round2((m.rollWidthCm / 100) * m.rollLengthM) : null;

export function sanitizeMaterial(body, cur = {}) {
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  return {
    sku: String(body.sku ?? cur.sku ?? '').trim().slice(0, 40),
    name: String(body.name ?? cur.name ?? '').trim().slice(0, 200),
    category: MATERIAL_CATEGORIES.includes(body.category) ? body.category : (cur.category || 'sticker'),
    unit: MATERIAL_UNITS.includes(body.unit) ? body.unit : (cur.unit || 'sqm'),
    rollWidthCm: num(body.rollWidthCm, cur.rollWidthCm ?? null),
    rollLengthM: num(body.rollLengthM, cur.rollLengthM ?? null),
    costPerUnit: Math.max(0, num(body.costPerUnit, cur.costPerUnit ?? 0)),
    reorderPoint: Math.max(0, num(body.reorderPoint, cur.reorderPoint ?? 0)),
    supplier: String(body.supplier ?? cur.supplier ?? '').trim().slice(0, 200),
    active: body.active === undefined ? (cur.active !== false) : !!body.active,
  };
}

/** Record a movement and update the material's balance (and avg cost on 'in'). */
export function recordMove(material, { type, qty, unitCost = null, refType = 'manual', refId = null, note = '', byUserId = null }) {
  const q = Number(qty);
  if (!['in', 'out', 'adjust'].includes(type)) throw new Error('invalid move type');
  if (!Number.isFinite(q) || q === 0) throw new Error('จำนวนต้องไม่เป็นศูนย์');
  const cur = Number(material.stockQty) || 0;

  let next = cur;
  let patch = {};
  if (type === 'in') {
    if (q < 0) throw new Error('รับเข้าต้องเป็นจำนวนบวก');
    next = round2(cur + q);
    // ต้นทุนถัวเฉลี่ยใหม่เมื่อระบุราคาซื้อ
    if (unitCost != null && Number(unitCost) >= 0) {
      const totalValue = cur * (material.costPerUnit || 0) + q * Number(unitCost);
      patch.costPerUnit = next > 0 ? round2(totalValue / next) : Number(unitCost);
    }
  } else if (type === 'out') {
    if (q < 0) throw new Error('จ่ายออกต้องเป็นจำนวนบวก');
    next = round2(cur - q); // ยอมติดลบได้ (ของจริงถูกใช้ไปแล้ว) แต่จะโดน low-stock เตือน
  } else {
    next = round2(cur + q); // adjust: q เป็น +/- ผลต่างจากการนับจริง
  }

  const move = db.erpStockMoves.insert({
    organizationId: material.organizationId,
    materialId: material.id,
    materialName: material.name,
    type, qty: round2(q),
    unitCost: unitCost != null ? Number(unitCost) : null,
    balanceAfter: next,
    refType, refId, note: String(note || '').slice(0, 300),
    byUserId,
  });
  db.erpMaterials.update(material.id, { stockQty: next, ...patch });
  checkLowStock(db.erpMaterials.get(material.id));
  bus.emit('erp:changed', { organizationId: material.organizationId, kind: 'stock' });
  return move;
}

/** Consume materials for an order's items (called when the job enters the queue). */
export function consumeForOrder(order, byUserId) {
  const moves = [];
  for (const item of order.items) {
    const material = db.erpMaterials.get(item.spec?.materialId);
    if (!material || !(item.usedSqm > 0)) continue;
    moves.push(recordMove(material, {
      type: 'out', qty: item.usedSqm, refType: 'order', refId: order.id,
      note: `ใบงาน ${order.number} — ${item.desc || item.spec.materialName}`, byUserId,
    }));
  }
  return moves;
}

/** Return consumed materials to stock (order cancelled after queueing). */
export function returnForOrder(order, byUserId) {
  const outs = db.erpStockMoves.filter((m) => m.refType === 'order' && m.refId === order.id && m.type === 'out');
  const moves = [];
  for (const m of outs) {
    const material = db.erpMaterials.get(m.materialId);
    if (!material) continue;
    moves.push(recordMove(material, {
      type: 'in', qty: m.qty, refType: 'order', refId: order.id,
      note: `คืนสต๊อก — ยกเลิกใบงาน ${order.number}`, byUserId,
    }));
  }
  return moves;
}

/** Alert ERP managers when a material crosses its reorder point (once/day). */
function checkLowStock(material) {
  if (!material || !(material.reorderPoint > 0)) return;
  if ((material.stockQty ?? 0) > material.reorderPoint) return;
  const today = new Date().toISOString().slice(0, 10);
  if (material.lowStockAlertedAt === today) return;
  db.erpMaterials.update(material.id, { lowStockAlertedAt: today });
  const unitLabel = material.unit === 'sqm' ? 'ตร.ม.' : material.unit;
  for (const u of db.users.filter((u) => u.organizationId === material.organizationId &&
    u.status !== 'disabled' && (can(u, PERMISSIONS.MANAGE_ERP) || can(u, PERMISSIONS.MANAGE_ADS)))) {
    notify(u.id, {
      type: 'erp',
      title: '📉 วัสดุใกล้หมด',
      body: `${material.name} เหลือ ${material.stockQty} ${unitLabel} (จุดสั่งซื้อ ${material.reorderPoint}) — ควรสั่งซื้อเพิ่ม`,
    });
  }
  log.info(`low stock: ${material.name} → ${material.stockQty}`);
}

export function lowStockList(orgId) {
  return db.erpMaterials.filter((m) => m.organizationId === orgId && m.active !== false &&
    m.reorderPoint > 0 && (m.stockQty ?? 0) <= m.reorderPoint);
}
