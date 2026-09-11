import { db } from '../store/db.js';
import { bus } from '../core/eventBus.js';
import { notify } from '../core/notifications.js';
import { sendReply } from '../core/conversations.js';
import { calcJobItem, docTotals } from './pricing.js';
import { orgErpSettings } from './settings.js';
import { nextDocNumber } from './docs.js';
import { consumeForOrder, returnForOrder } from './stock.js';
import { logger } from '../logger.js';

const log = logger('erp-orders');

/**
 * Quote → Job order lifecycle for a made-to-order print shop.
 *
 * Single production queue (per the shop's choice): every job walks the same
 * status lane. Entering 'queued' cuts raw-material stock automatically;
 * cancelling after that returns it. Selected status changes can message the
 * customer directly in their original chat channel.
 */
export const ORDER_STATUSES = ['confirmed', 'artwork', 'queued', 'printing', 'finishing', 'qc', 'packed', 'shipped', 'done', 'cancelled'];
export const ORDER_STATUS_LABEL = {
  confirmed: '🆕 รับงาน', artwork: '🎨 รอไฟล์/อนุมัติแบบ', queued: '📋 เข้าคิวผลิต',
  printing: '🖨️ กำลังพิมพ์', finishing: '✂️ ไดคัท/เคลือบ', qc: '🔍 ตรวจงาน',
  packed: '📦 แพ็คแล้ว', shipped: '🚚 จัดส่งแล้ว', done: '✅ ปิดงาน', cancelled: '✕ ยกเลิก',
};
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

const round2 = (n) => Math.round(n * 100) / 100;

/** Build normalized line items (with fresh price calc) from raw item specs. */
export function buildItems(orgId, rawItems, tier) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error('ต้องมีรายการอย่างน้อย 1 รายการ');
  return rawItems.slice(0, 30).map((raw) => {
    const calc = calcJobItem(orgId, raw.spec || raw, { tier });
    const unitPrice = raw.unitPrice != null && Number(raw.unitPrice) > 0 ? Number(raw.unitPrice) : calc.unitPrice;
    const amount = round2(unitPrice * calc.spec.qty);
    return {
      desc: String(raw.desc || `สติกเกอร์ ${calc.spec.materialName} ${calc.spec.widthCm}×${calc.spec.heightCm} ซม.`).slice(0, 300),
      spec: calc.spec,
      printedSqm: calc.printedSqm,
      usedSqm: calc.usedSqm,
      costSnapshot: calc.cost,
      unitPrice: round2(unitPrice),
      amount,
      dieId: raw.dieId || null,
    };
  });
}

// ── Quotes ──────────────────────────────────────────────────────────────────
export function createQuote(orgId, user, { customerId, conversationId = null, items, discount = 0, note = '' }) {
  const customer = db.erpCustomers.get(customerId);
  if (!customer || customer.organizationId !== orgId) throw new Error('ไม่พบลูกค้า');
  const s = orgErpSettings(orgId);
  const built = buildItems(orgId, items, customer.tier);
  const totals = docTotals(orgId, built, { discount });
  const quote = db.erpQuotes.insert({
    organizationId: orgId,
    number: nextDocNumber(orgId, 'QT'),
    customerId, customerName: customer.name, tier: customer.tier,
    conversationId,
    items: built, ...totals,
    note: String(note || '').slice(0, 500),
    status: 'draft',
    validUntil: new Date(Date.now() + s.quoteValidDays * 86400000).toISOString(),
    createdBy: user.id, createdByName: user.name,
  });
  bus.emit('erp:changed', { organizationId: orgId, kind: 'quote' });
  return quote;
}

export function updateQuote(quote, user, { items, discount, note, status, customerId }) {
  if (!['draft', 'sent'].includes(quote.status) && items) throw new Error('ใบเสนอราคานี้ถูกใช้ไปแล้ว แก้ไขไม่ได้');
  const patch = {};
  if (customerId) {
    const customer = db.erpCustomers.get(customerId);
    if (!customer) throw new Error('ไม่พบลูกค้า');
    patch.customerId = customer.id; patch.customerName = customer.name; patch.tier = customer.tier;
  }
  if (items) {
    const tier = patch.tier || quote.tier;
    patch.items = buildItems(quote.organizationId, items, tier);
    Object.assign(patch, docTotals(quote.organizationId, patch.items, { discount: discount ?? quote.discount }));
  } else if (discount !== undefined) {
    Object.assign(patch, docTotals(quote.organizationId, quote.items, { discount }));
  }
  if (note !== undefined) patch.note = String(note).slice(0, 500);
  if (status && QUOTE_STATUSES.includes(status)) patch.status = status;
  const updated = db.erpQuotes.update(quote.id, patch);
  bus.emit('erp:changed', { organizationId: quote.organizationId, kind: 'quote' });
  return updated;
}

/** Accepted quote → job order (the moment a customer says "เอาค่ะ"). */
export function convertQuoteToOrder(quote, user, { dueDate = null } = {}) {
  if (quote.orderId) throw new Error('ใบเสนอราคานี้ถูกแปลงเป็นใบงานแล้ว');
  const order = db.erpOrders.insert({
    organizationId: quote.organizationId,
    number: nextDocNumber(quote.organizationId, 'JOB'),
    quoteId: quote.id, quoteNumber: quote.number,
    customerId: quote.customerId, customerName: quote.customerName, tier: quote.tier,
    conversationId: quote.conversationId,
    items: quote.items,
    subTotal: quote.subTotal, discount: quote.discount, vat: quote.vat, wht: quote.wht,
    grandTotal: quote.grandTotal, netReceivable: quote.netReceivable,
    status: 'confirmed',
    dueDate, priority: 'normal',
    notifyCustomer: !!quote.conversationId,
    shipping: { method: '', trackingNo: '', address: '' },
    payments: [], paidAmount: 0, paymentStatus: 'unpaid',
    stockConsumedAt: null,
    timeline: [{ at: new Date().toISOString(), by: user.name, from: null, to: 'confirmed', note: `จากใบเสนอราคา ${quote.number}` }],
    createdBy: user.id, createdByName: user.name,
  });
  db.erpQuotes.update(quote.id, { status: 'accepted', orderId: order.id, orderNumber: order.number });
  bus.emit('erp:changed', { organizationId: order.organizationId, kind: 'order' });
  return order;
}

// ── Orders ──────────────────────────────────────────────────────────────────
function renderTemplate(tpl, order) {
  return String(tpl || '')
    .replaceAll('{{number}}', order.number)
    .replaceAll('{{tracking}}', order.shipping?.trackingNo || '-');
}

/** Fire-and-forget: push a status update into the customer's chat channel. */
async function notifyCustomerInChat(order, user, status) {
  if (!order.notifyCustomer || !order.conversationId) return;
  const tpl = orgErpSettings(order.organizationId).notifyTemplates[status];
  if (!tpl) return;
  try {
    await sendReply(order.conversationId, user, renderTemplate(tpl, order));
    log.info(`notified customer of ${order.number} → ${status}`);
  } catch (e) {
    log.warn(`customer notify failed for ${order.number}: ${e.message}`);
    notify(user.id, {
      type: 'erp', title: '⚠️ ส่งข้อความแจ้งลูกค้าไม่สำเร็จ',
      body: `${order.number}: ${e.message}`, conversationId: order.conversationId,
    });
  }
}

export async function setOrderStatus(orderId, user, status, { note = '' } = {}) {
  const order = db.erpOrders.get(orderId);
  if (!order) throw new Error('ไม่พบใบงาน');
  if (!ORDER_STATUSES.includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  if (order.status === status) return order;

  const patch = {
    status,
    timeline: [...order.timeline, {
      at: new Date().toISOString(), by: user.name, from: order.status, to: status,
      note: String(note || '').slice(0, 300),
    }],
  };

  // เข้าคิวผลิตครั้งแรก → ตัดสต๊อกวัสดุอัตโนมัติ
  if (status === 'queued' && !order.stockConsumedAt) {
    consumeForOrder(order, user.id);
    patch.stockConsumedAt = new Date().toISOString();
  }
  // ยกเลิกหลังตัดสต๊อกไปแล้ว → คืนสต๊อกให้อัตโนมัติ
  if (status === 'cancelled' && order.stockConsumedAt) {
    returnForOrder(order, user.id);
  }

  const updated = db.erpOrders.update(order.id, patch);
  bus.emit('erp:changed', { organizationId: order.organizationId, kind: 'order' });
  await notifyCustomerInChat(updated, user, status);
  return updated;
}

/** Record a payment; keeps status + the chat deal value in sync. */
export function recordPayment(orderId, user, { amount, method = 'โอน', note = '' }) {
  const order = db.erpOrders.get(orderId);
  if (!order) throw new Error('ไม่พบใบงาน');
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('ยอดชำระต้องมากกว่า 0');
  const payments = [...order.payments, {
    amount: round2(amt), method: String(method).slice(0, 60),
    note: String(note || '').slice(0, 200),
    at: new Date().toISOString(), by: user.name,
  }];
  const paidAmount = round2(payments.reduce((s, x) => s + x.amount, 0));
  const paymentStatus = paidAmount >= order.grandTotal - 0.01 ? 'paid' : 'deposit';
  const updated = db.erpOrders.update(order.id, { payments, paidAmount, paymentStatus });

  // ยอดขายจริงไหลกลับไปที่แชต → รายงาน ROI ของ Ads AI ใช้รายได้จริง
  if (order.conversationId) {
    const conv = db.conversations.get(order.conversationId);
    if (conv) {
      db.conversations.update(conv.id, { dealValue: (Number(conv.dealValue) || 0) + round2(amt) });
      bus.emit('conversation:upserted', db.conversations.get(conv.id));
    }
  }
  bus.emit('erp:changed', { organizationId: order.organizationId, kind: 'order' });
  return updated;
}

/** Issue an invoice/receipt document for an order. */
export function issueDocument(order, user, type) {
  if (!['invoice', 'receipt'].includes(type)) throw new Error('invalid doc type');
  const doc = db.erpInvoices.insert({
    organizationId: order.organizationId,
    number: nextDocNumber(order.organizationId, type === 'invoice' ? 'INV' : 'RC'),
    type, orderId: order.id, orderNumber: order.number,
    customerId: order.customerId, customerName: order.customerName,
    amount: type === 'receipt' ? order.paidAmount : order.grandTotal,
    issuedBy: user.name, issuedById: user.id,
  });
  bus.emit('erp:changed', { organizationId: order.organizationId, kind: 'doc' });
  return doc;
}
