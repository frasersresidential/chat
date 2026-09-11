import { db } from '../store/db.js';

/**
 * ERP settings live on the organization document (org.erp), same pattern as
 * adsPolicy / businessHours. Everything the price calculator and documents
 * need is configurable here — including VAT, shipped OFF by default because
 * the business isn't VAT-registered yet: flipping the switch later changes
 * documents without code changes.
 */
export function defaultErpSettings() {
  return {
    company: {
      name: 'โรงพิมพ์สติกเกอร์ Company A',
      address: '',
      phone: '',
      taxId: '',
    },
    // ภาษี: ปิดไว้ก่อน (ยังไม่จด VAT) — เปิดเมื่อไรเอกสารคิด 7% ให้ทันที
    vat: { enabled: false, rate: 7 },
    wht: { enabled: false, rate: 3 }, // หัก ณ ที่จ่าย (แสดงบนใบแจ้งหนี้เมื่อเปิด)
    // อัตราคิดราคา (฿/ตร.ม. เว้นแต่ระบุ)
    pricing: {
      printCostPerSqm: 120,      // หมึก + ค่าเครื่อง + ค่าแรงพิมพ์
      laminate: { none: 0, gloss: 40, matte: 45, uv: 90 },
      dieCutSetupFee: 800,       // ทำบล็อกไดคัทใหม่
      dieCutPerSqm: 25,          // ค่าไดคัทตามพื้นที่
      cutPerSqm: 10,             // ตัดตรงธรรมดา
      wastePct: 10,              // เผื่อเสียวัสดุ
      margin: { retail: 60, wholesale: 35, vip: 25 }, // % กำไรตามเทียร์ลูกค้า
      minJobPrice: 300,          // ราคาขั้นต่ำต่อใบงาน
    },
    quoteValidDays: 15,
    // ข้อความแจ้งสถานะเข้าแชตลูกค้า ({{number}} = เลขใบงาน, {{tracking}} = เลขพัสดุ)
    notifyTemplates: {
      queued: '🖨️ งาน {{number}} ของคุณเข้าคิวผลิตแล้วค่ะ เดี๋ยวแจ้งความคืบหน้าเป็นระยะนะคะ',
      printing: '⚙️ งาน {{number}} กำลังพิมพ์อยู่ค่ะ',
      shipped: '📦 งาน {{number}} จัดส่งแล้วค่ะ เลขพัสดุ: {{tracking}} ขอบคุณที่ใช้บริการนะคะ 🙏',
    },
  };
}

const num = (v, fallback, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v, fallback) => (typeof v === 'string' ? v.slice(0, 500) : fallback);

export function sanitizeErpSettings(body = {}, cur = defaultErpSettings()) {
  const p = body.pricing || {};
  const cp = cur.pricing;
  return {
    company: {
      name: str(body.company?.name, cur.company.name),
      address: str(body.company?.address, cur.company.address),
      phone: str(body.company?.phone, cur.company.phone),
      taxId: str(body.company?.taxId, cur.company.taxId),
    },
    vat: {
      enabled: body.vat?.enabled === undefined ? cur.vat.enabled : !!body.vat.enabled,
      rate: num(body.vat?.rate, cur.vat.rate, 0, 30),
    },
    wht: {
      enabled: body.wht?.enabled === undefined ? cur.wht.enabled : !!body.wht.enabled,
      rate: num(body.wht?.rate, cur.wht.rate, 0, 15),
    },
    pricing: {
      printCostPerSqm: num(p.printCostPerSqm, cp.printCostPerSqm, 0, 1e6),
      laminate: {
        none: 0,
        gloss: num(p.laminate?.gloss, cp.laminate.gloss, 0, 1e6),
        matte: num(p.laminate?.matte, cp.laminate.matte, 0, 1e6),
        uv: num(p.laminate?.uv, cp.laminate.uv, 0, 1e6),
      },
      dieCutSetupFee: num(p.dieCutSetupFee, cp.dieCutSetupFee, 0, 1e6),
      dieCutPerSqm: num(p.dieCutPerSqm, cp.dieCutPerSqm, 0, 1e6),
      cutPerSqm: num(p.cutPerSqm, cp.cutPerSqm, 0, 1e6),
      wastePct: num(p.wastePct, cp.wastePct, 0, 80),
      margin: {
        retail: num(p.margin?.retail, cp.margin.retail, 0, 900),
        wholesale: num(p.margin?.wholesale, cp.margin.wholesale, 0, 900),
        vip: num(p.margin?.vip, cp.margin.vip, 0, 900),
      },
      minJobPrice: num(p.minJobPrice, cp.minJobPrice, 0, 1e7),
    },
    quoteValidDays: num(body.quoteValidDays, cur.quoteValidDays, 1, 365),
    notifyTemplates: {
      queued: str(body.notifyTemplates?.queued, cur.notifyTemplates.queued),
      printing: str(body.notifyTemplates?.printing, cur.notifyTemplates.printing),
      shipped: str(body.notifyTemplates?.shipped, cur.notifyTemplates.shipped),
    },
  };
}

export function orgErpSettings(orgOrId) {
  const org = typeof orgOrId === 'string' ? db.organizations.get(orgOrId) : orgOrId;
  const cur = defaultErpSettings();
  return org?.erp ? sanitizeErpSettings(org.erp, cur) : cur;
}
