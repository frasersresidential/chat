import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { seedIfEmpty } from '../src/store/seed.js';
import { seedErpIfEmpty } from '../src/erp/seed.js';
import { calcJobItem, docTotals } from '../src/erp/pricing.js';
import { defaultErpSettings, sanitizeErpSettings, orgErpSettings } from '../src/erp/settings.js';
import { recordMove, rollSqm, lowStockList } from '../src/erp/stock.js';
import {
  createQuote, updateQuote, convertQuoteToOrder, setOrderStatus, recordPayment, issueDocument,
} from '../src/erp/orders.js';
import { ingestInbound } from '../src/core/conversations.js';

db._reset();
seedIfEmpty();
seedErpIfEmpty();

const ORG = 'org_company_a';
const user = db.users.get('u_sales1');
const manager = db.users.get('u_manager');

test('ERP seed is idempotent and themes to a sticker factory', () => {
  const before = db.erpMaterials.all().length;
  seedErpIfEmpty(); // second run must not duplicate
  assert.equal(db.erpMaterials.all().length, before);
  assert.ok(db.erpMaterials.find((m) => m.name.includes('PVC')));
  assert.ok(db.erpCustomers.all().length >= 3);
  assert.ok(db.erpOrders.all().length >= 3, 'demo jobs exist for the demo org');
});

test('roll materials convert roll size → sqm', () => {
  const pvc = db.erpMaterials.get('mat_pvc_wg'); // 32cm × 50m
  assert.equal(rollSqm(pvc), 16);
});

test('price calculator: area, waste, die fee, tier margin and floor', () => {
  // 5×5 ซม. × 1000 ชิ้น = 2.5 ตร.ม. พิมพ์, +10% waste = 2.75 ตร.ม. วัสดุ
  const r = calcJobItem(ORG, {
    materialId: 'mat_pvc_wg', widthCm: 5, heightCm: 5, qty: 1000,
    laminate: 'gloss', cutType: 'diecut', dieMode: 'new',
  }, { tier: 'retail' });
  assert.equal(r.printedSqm, 2.5);
  assert.equal(r.usedSqm, 2.75);
  assert.equal(r.cost.dieSetup, 800);                    // บล็อกใหม่
  assert.equal(r.cost.material, 2.75 * 45);              // PVC ฿45/ตร.ม.
  assert.ok(r.amount >= r.cost.total, 'price covers cost');
  assert.equal(r.amount % 10, 0, 'price rounded to ฿10');

  // ใช้บล็อกเดิม → ไม่มีค่าบล็อก และ VIP ถูกกว่า retail
  const reuse = calcJobItem(ORG, {
    materialId: 'mat_pvc_wg', widthCm: 5, heightCm: 5, qty: 1000,
    laminate: 'gloss', cutType: 'diecut', dieMode: 'existing',
  }, { tier: 'vip' });
  assert.equal(reuse.cost.dieSetup, 0);
  assert.ok(reuse.amount < r.amount);

  // งานจิ๋วโดนราคาขั้นต่ำ
  const tiny = calcJobItem(ORG, { materialId: 'mat_pvc_wg', widthCm: 2, heightCm: 2, qty: 10, laminate: 'none', cutType: 'none' });
  assert.equal(tiny.amount, orgErpSettings(ORG).pricing.minJobPrice);
});

test('VAT switch changes documents without code changes', () => {
  const items = [{ amount: 1000 }];
  const off = docTotals(ORG, items);
  assert.equal(off.vat.amount, 0);
  assert.equal(off.grandTotal, 1000);

  const org = db.organizations.get(ORG);
  db.organizations.update(ORG, { erp: sanitizeErpSettings({ vat: { enabled: true, rate: 7 } }, orgErpSettings(org)) });
  const on = docTotals(ORG, items);
  assert.equal(on.vat.amount, 70);
  assert.equal(on.grandTotal, 1070);
  db.organizations.update(ORG, { erp: sanitizeErpSettings({ vat: { enabled: false } }, orgErpSettings(ORG)) });
});

test('stock: in updates average cost, adjust journals a balance', () => {
  const m0 = db.erpMaterials.get('mat_pp_clear'); // 64 sqm @ ฿55
  recordMove(m0, { type: 'in', qty: 64, unitCost: 65, refType: 'purchase' });
  const m1 = db.erpMaterials.get('mat_pp_clear');
  assert.equal(m1.stockQty, 128);
  assert.equal(m1.costPerUnit, 60); // (64×55 + 64×65) / 128

  recordMove(m1, { type: 'adjust', qty: -8, note: 'นับจริง' });
  assert.equal(db.erpMaterials.get('mat_pp_clear').stockQty, 120);
  const last = db.erpStockMoves.all().at(-1);
  assert.equal(last.balanceAfter, 120);
});

test('full flow: chat → quote → order → queue cuts stock → pay syncs dealValue → cancel returns stock', async () => {
  const mock = db.channelAccounts.find((c) => c.channelType === 'mock');
  const { conversation } = ingestInbound(mock, {
    participantId: 'flow_1', participantName: 'ลูกค้า Flow', text: 'สวัสดี',
    externalMessageId: 'f1', timestamp: new Date().toISOString(),
  });
  const customer = db.erpCustomers.insert({ organizationId: ORG, name: 'ลูกค้า Flow', tier: 'retail', conversationId: conversation.id });

  const quote = createQuote(ORG, user, {
    customerId: customer.id, conversationId: conversation.id,
    items: [{ spec: { materialId: 'mat_paper_art', widthCm: 10, heightCm: 10, qty: 400, laminate: 'none', cutType: 'straight' } }],
  });
  assert.match(quote.number, /^QT-\d{4}-\d{4}$/);

  const order = convertQuoteToOrder(db.erpQuotes.get(quote.id), user, {});
  assert.match(order.number, /^JOB-\d{4}-\d{4}$/);
  assert.equal(db.erpQuotes.get(quote.id).status, 'accepted');
  assert.throws(() => convertQuoteToOrder(db.erpQuotes.get(quote.id), user, {}), /แปลงเป็นใบงานแล้ว/);

  // เข้าคิว → ตัดสต๊อกเท่า usedSqm (4 ตร.ม. × 1.1 = 4.4)
  const before = db.erpMaterials.get('mat_paper_art').stockQty;
  await setOrderStatus(order.id, user, 'queued');
  const afterQueue = db.erpMaterials.get('mat_paper_art').stockQty;
  assert.equal(Math.round((before - afterQueue) * 100) / 100, order.items[0].usedSqm);

  // เข้าคิวซ้ำสถานะอื่นไม่ตัดซ้ำ
  await setOrderStatus(order.id, user, 'printing');
  assert.equal(db.erpMaterials.get('mat_paper_art').stockQty, afterQueue);

  // แจ้งลูกค้าในแชตอัตโนมัติ (queued + printing มีเทมเพลต)
  const outMsgs = db.messages.filter((m) => m.conversationId === conversation.id && m.direction === 'out' && m.text.includes(order.number));
  assert.equal(outMsgs.length, 2);

  // รับเงิน → paymentStatus + dealValue ของแชตอัปเดต (ให้ Ads ROI ใช้ยอดจริง)
  recordPayment(order.id, user, { amount: db.erpOrders.get(order.id).grandTotal });
  assert.equal(db.erpOrders.get(order.id).paymentStatus, 'paid');
  assert.equal(db.conversations.get(conversation.id).dealValue, db.erpOrders.get(order.id).grandTotal);

  const receipt = issueDocument(db.erpOrders.get(order.id), user, 'receipt');
  assert.match(receipt.number, /^RC-/);

  // ยกเลิกหลังตัดสต๊อก → คืนอัตโนมัติ
  await setOrderStatus(order.id, user, 'cancelled');
  assert.equal(db.erpMaterials.get('mat_paper_art').stockQty, before);
});

test('quote edits are blocked once converted', () => {
  const q = db.erpQuotes.find((x) => x.status === 'accepted');
  assert.throws(() => updateQuote(q, user, { items: [{ spec: { materialId: 'mat_pvc_wg', widthCm: 5, heightCm: 5, qty: 100 } }] }), /แก้ไขไม่ได้/);
});

test('low-stock crossing notifies ERP managers once per day', () => {
  const kraft = db.erpMaterials.get('mat_kraft'); // reorder 32
  db.erpMaterials.update(kraft.id, { stockQty: 40, lowStockAlertedAt: null });
  const notifBefore = db.notifications.filter((n) => n.title.includes('วัสดุใกล้หมด')).length;
  recordMove(db.erpMaterials.get(kraft.id), { type: 'out', qty: 10, refType: 'manual' }); // 30 < 32
  const notifAfter = db.notifications.filter((n) => n.title.includes('วัสดุใกล้หมด')).length;
  assert.ok(notifAfter > notifBefore, 'alert fired');
  assert.ok(db.notifications.find((n) => n.userId === manager.id && n.title.includes('วัสดุใกล้หมด')), 'manager notified');

  recordMove(db.erpMaterials.get(kraft.id), { type: 'out', qty: 2, refType: 'manual' });
  assert.equal(db.notifications.filter((n) => n.title.includes('วัสดุใกล้หมด')).length, notifAfter, 'no duplicate same-day alert');
  assert.ok(lowStockList(ORG).find((m) => m.id === kraft.id));
});

test('document numbers run sequentially per type', () => {
  const c = db.erpCustomers.get('cust_jane');
  const mk = () => createQuote(ORG, user, {
    customerId: c.id,
    items: [{ spec: { materialId: 'mat_pvc_wg', widthCm: 5, heightCm: 5, qty: 100, laminate: 'none', cutType: 'none' } }],
  });
  const a = mk(), b = mk();
  const seq = (n) => Number(n.split('-')[2]);
  assert.equal(seq(b.number), seq(a.number) + 1);
});
