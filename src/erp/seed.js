import { db } from '../store/db.js';
import { defaultErpSettings } from './settings.js';
import { buildItems } from './orders.js';
import { docTotals } from './pricing.js';
import { nextDocNumber } from './docs.js';
import { recordMove } from './stock.js';
import { logger } from '../logger.js';

const log = logger('erp-seed');

/**
 * Idempotent ERP starter data per organization. Runs at every boot (not only
 * on an empty store) so existing deployments get their material catalog the
 * first time they update to a build that ships the ERP.
 */
export function seedErpIfEmpty() {
  for (const org of db.organizations.all()) {
    if (db.erpMaterials.find((m) => m.organizationId === org.id)) continue;
    seedForOrg(org);
  }
}

function seedForOrg(org) {
  const O = org.id;
  log.info(`seeding ERP starter data for ${org.name}...`);
  if (!org.erp) db.organizations.update(O, { erp: defaultErpSettings() });

  // ── วัสดุ (ม้วน → เก็บสต๊อกเป็น ตร.ม.) ──────────────────────────────────
  const mat = (id, sku, name, category, unit, extra) => db.erpMaterials.insert({
    id, organizationId: O, sku, name, category, unit,
    rollWidthCm: null, rollLengthM: null, supplier: '', active: true,
    lowStockAlertedAt: null, ...extra,
  });
  mat('mat_pvc_wg', 'PVC-WG', 'สติกเกอร์ PVC ขาวเงา', 'sticker', 'sqm',
    { rollWidthCm: 32, rollLengthM: 50, costPerUnit: 45, stockQty: 128, reorderPoint: 32, supplier: 'สยามสติ๊กเกอร์' });
  mat('mat_pvc_wm', 'PVC-WM', 'สติกเกอร์ PVC ขาวด้าน', 'sticker', 'sqm',
    { rollWidthCm: 32, rollLengthM: 50, costPerUnit: 45, stockQty: 96, reorderPoint: 32, supplier: 'สยามสติ๊กเกอร์' });
  mat('mat_pp_clear', 'PP-CL', 'สติกเกอร์ PP ใส กันน้ำ', 'sticker', 'sqm',
    { rollWidthCm: 32, rollLengthM: 50, costPerUnit: 55, stockQty: 64, reorderPoint: 32, supplier: 'สยามสติ๊กเกอร์' });
  mat('mat_paper_art', 'PA-ART', 'สติกเกอร์กระดาษอาร์ตมัน', 'sticker', 'sqm',
    { rollWidthCm: 32, rollLengthM: 100, costPerUnit: 25, stockQty: 160, reorderPoint: 64, supplier: 'กระดาษไทย' });
  mat('mat_kraft', 'PA-KRAFT', 'สติกเกอร์กระดาษคราฟท์', 'sticker', 'sqm',
    { rollWidthCm: 32, rollLengthM: 50, costPerUnit: 30, stockQty: 24, reorderPoint: 32, supplier: 'กระดาษไทย' }); // ใกล้หมด → เดโม่แจ้งเตือน
  mat('mat_lam_gloss', 'LAM-G', 'ฟิล์มลามิเนตเงา', 'laminate', 'sqm',
    { rollWidthCm: 33, rollLengthM: 100, costPerUnit: 18, stockQty: 180, reorderPoint: 66 });
  mat('mat_lam_matte', 'LAM-M', 'ฟิล์มลามิเนตด้าน', 'laminate', 'sqm',
    { rollWidthCm: 33, rollLengthM: 100, costPerUnit: 20, stockQty: 140, reorderPoint: 66 });
  mat('mat_core', 'CORE-3', 'แกนกระดาษ 3 นิ้ว', 'core', 'pcs',
    { costPerUnit: 8, stockQty: 120, reorderPoint: 30 });
  mat('mat_box', 'BOX-M', 'กล่องพัสดุ M', 'packaging', 'pcs',
    { costPerUnit: 6, stockQty: 200, reorderPoint: 50 });

  // ── ลูกค้าตัวอย่าง (เทียร์ต่างกัน → ราคาต่างกัน) ─────────────────────────
  const cust = (id, name, tier, extra = {}) => db.erpCustomers.insert({
    id, organizationId: O, name, tier, phone: '', email: '', taxId: '', address: '', note: '', ...extra,
  });
  cust('cust_som', 'ร้านครีมคุณส้ม', 'vip', { phone: '081-111-2222', note: 'สั่งประจำทุกเดือน ฉลากครีม' });
  cust('cust_organic', 'บจก. ออร์แกนิคฟาร์ม', 'wholesale', { phone: '02-333-4444', taxId: '0105561234567' });
  cust('cust_jane', 'คุณเจน เพจขนมโฮมเมด', 'retail', { phone: '089-555-6666' });

  // ── บล็อกไดคัทของลูกค้า (สั่งซ้ำไม่ต้องจ่ายค่าบล็อกใหม่) ─────────────────
  db.erpDies.insert({
    id: 'die_som_oval', organizationId: O, customerId: 'cust_som',
    name: 'บล็อกวงรี 6×4 ซม. — ฉลากครีมคุณส้ม', sizeSpec: '6×4 ซม. วงรี',
    location: 'ชั้นเก็บบล็อก A-03', note: '',
  });

  // ── ตัวอย่างเอกสาร/ใบงาน (เฉพาะ org เดโม่ ไม่แตะ org จริงอื่น) ──────────
  if (O === 'org_company_a') seedDemoJobs(O);

  log.info(`ERP seed for ${org.name}: ${db.erpMaterials.filter((m) => m.organizationId === O).length} materials, ` +
    `${db.erpCustomers.filter((c) => c.organizationId === O).length} customers`);
}

/** A few realistic documents so the dashboard/queue isn't empty on first open. */
function seedDemoJobs(O) {
  const now = Date.now();
  const iso = (offsetH) => new Date(now - offsetH * 3600000).toISOString();

  const mkOrder = (customerId, rawItems, { status, dueInDays, payFull = false, tracking = '' }) => {
    const customer = db.erpCustomers.get(customerId);
    const items = buildItems(O, rawItems, customer.tier);
    const totals = docTotals(O, items, { discount: 0 });
    const quote = db.erpQuotes.insert({
      organizationId: O, number: nextDocNumber(O, 'QT'),
      customerId, customerName: customer.name, tier: customer.tier, conversationId: null,
      items, ...totals, note: '', status: 'accepted',
      validUntil: new Date(now + 15 * 86400000).toISOString(),
      createdBy: 'u_sales1', createdByName: 'Sales 1',
    });
    const order = db.erpOrders.insert({
      organizationId: O, number: nextDocNumber(O, 'JOB'),
      quoteId: quote.id, quoteNumber: quote.number,
      customerId, customerName: customer.name, tier: customer.tier, conversationId: null,
      items, subTotal: totals.subTotal, discount: 0, vat: totals.vat, wht: totals.wht,
      grandTotal: totals.grandTotal, netReceivable: totals.netReceivable,
      status, dueDate: new Date(now + dueInDays * 86400000).toISOString(), priority: 'normal',
      notifyCustomer: false,
      shipping: { method: tracking ? 'Kerry' : '', trackingNo: tracking, address: '' },
      payments: payFull ? [{ amount: totals.grandTotal, method: 'โอน', note: 'ชำระครบ', at: iso(4), by: 'Sales 1' }] : [],
      paidAmount: payFull ? totals.grandTotal : 0,
      paymentStatus: payFull ? 'paid' : 'unpaid',
      stockConsumedAt: ['queued', 'printing', 'finishing', 'qc', 'packed', 'shipped', 'done'].includes(status) ? iso(20) : null,
      timeline: [{ at: iso(26), by: 'Sales 1', from: null, to: 'confirmed', note: `จากใบเสนอราคา ${quote.number}` },
        ...(status !== 'confirmed' ? [{ at: iso(20), by: 'Sales 1', from: 'confirmed', to: status, note: '' }] : [])],
      createdBy: 'u_sales1', createdByName: 'Sales 1',
    });
    db.erpQuotes.update(quote.id, { orderId: order.id, orderNumber: order.number });
    // ใบงานที่เข้าคิวแล้ว → บันทึกการตัดสต๊อกจริงให้ประวัติ/ยอดคงเหลือตรงกัน
    if (order.stockConsumedAt) {
      for (const item of order.items) {
        const material = db.erpMaterials.get(item.spec.materialId);
        if (material && item.usedSqm > 0) {
          recordMove(material, {
            type: 'out', qty: item.usedSqm, refType: 'order', refId: order.id,
            note: `ใบงาน ${order.number} — ${item.desc}`, byUserId: 'u_sales1',
          });
        }
      }
    }
    return order;
  };

  // งานฉลากครีม (VIP, ใช้บล็อกเดิม) — กำลังพิมพ์
  mkOrder('cust_som', [{
    desc: 'ฉลากครีมวงรี 6×4 ซม. PVC ขาวเงา เคลือบเงา (ใช้บล็อกเดิม)',
    spec: { materialId: 'mat_pvc_wg', widthCm: 6, heightCm: 4, qty: 2000, laminate: 'gloss', cutType: 'diecut', dieMode: 'existing' },
    dieId: 'die_som_oval',
  }], { status: 'printing', dueInDays: 2 });

  // งานโลโก้ร้านขนม (retail) — เพิ่งรับ รอไฟล์
  mkOrder('cust_jane', [{
    desc: 'สติกเกอร์โลโก้ 5×5 ซม. PP ใสกันน้ำ ไดคัทใหม่',
    spec: { materialId: 'mat_pp_clear', widthCm: 5, heightCm: 5, qty: 500, laminate: 'none', cutType: 'diecut', dieMode: 'new' },
  }], { status: 'artwork', dueInDays: 5 });

  // งานฉลากขวด (wholesale) — ส่งแล้ว + ชำระครบ
  mkOrder('cust_organic', [{
    desc: 'ฉลากขวดน้ำผัก 8×12 ซม. กระดาษอาร์ตมัน เคลือบด้าน ตัดตรง',
    spec: { materialId: 'mat_paper_art', widthCm: 8, heightCm: 12, qty: 3000, laminate: 'matte', cutType: 'straight' },
  }], { status: 'shipped', dueInDays: -1, payFull: true, tracking: 'TH0123456789' });

  // ใบเสนอราคาที่ยังรอลูกค้าตอบ
  const jane = db.erpCustomers.get('cust_jane');
  const qItems = buildItems(O, [{
    desc: 'สติกเกอร์ขอบคุณ 4×4 ซม. กระดาษคราฟท์',
    spec: { materialId: 'mat_kraft', widthCm: 4, heightCm: 4, qty: 1000, laminate: 'none', cutType: 'straight' },
  }], jane.tier);
  db.erpQuotes.insert({
    organizationId: O, number: nextDocNumber(O, 'QT'),
    customerId: jane.id, customerName: jane.name, tier: jane.tier, conversationId: null,
    items: qItems, ...docTotals(O, qItems, { discount: 0 }), note: 'ลูกค้าขอราคาเทียบ 2 เจ้า',
    status: 'sent', validUntil: new Date(now + 15 * 86400000).toISOString(),
    createdBy: 'u_sales2', createdByName: 'Sales 2',
  });
}
