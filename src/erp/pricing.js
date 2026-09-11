import { db } from '../store/db.js';
import { orgErpSettings } from './settings.js';

/**
 * Price calculator for made-to-order sticker jobs.
 *
 * Input spec (one quote/order line):
 *   { materialId, widthCm, heightCm, qty,
 *     laminate: 'none'|'gloss'|'matte'|'uv',
 *     cutType: 'none'|'straight'|'diecut',
 *     dieMode: 'new'|'existing' }         // diecut only — existing = reuse บล็อกเดิม
 *
 * Output: full cost breakdown + suggested price for the customer's tier, so
 * sales can quote inside a chat in seconds and staff can see the margin.
 */
export const LAMINATES = ['none', 'gloss', 'matte', 'uv'];
export const CUT_TYPES = ['none', 'straight', 'diecut'];

const round2 = (n) => Math.round(n * 100) / 100;

export function calcJobItem(orgId, spec, { tier = 'retail' } = {}) {
  const s = orgErpSettings(orgId);
  const p = s.pricing;
  const material = db.erpMaterials.get(spec.materialId);
  if (!material) throw new Error('ไม่พบวัสดุที่เลือก');
  if (material.unit !== 'sqm') throw new Error('วัสดุนี้ไม่ใช่วัสดุพิมพ์ (ต้องเป็นแบบตารางเมตร)');

  const widthCm = Number(spec.widthCm), heightCm = Number(spec.heightCm), qty = Math.round(Number(spec.qty));
  if (!(widthCm > 0) || !(heightCm > 0)) throw new Error('ต้องระบุขนาดชิ้นงาน (ซม.) มากกว่า 0');
  if (!(qty > 0)) throw new Error('ต้องระบุจำนวนชิ้นมากกว่า 0');
  const laminate = LAMINATES.includes(spec.laminate) ? spec.laminate : 'none';
  const cutType = CUT_TYPES.includes(spec.cutType) ? spec.cutType : 'none';
  const dieMode = cutType === 'diecut' ? (spec.dieMode === 'existing' ? 'existing' : 'new') : null;

  const pieceSqm = (widthCm * heightCm) / 10000;
  const printedSqm = round2(pieceSqm * qty);
  const usedSqm = round2(printedSqm * (1 + p.wastePct / 100)); // วัสดุที่ตัดจากสต๊อกจริง

  const materialCost = round2(usedSqm * (material.costPerUnit || 0));
  const printCost = round2(printedSqm * p.printCostPerSqm);
  const laminateCost = round2(printedSqm * (p.laminate[laminate] || 0));
  const cutCost = cutType === 'diecut' ? round2(printedSqm * p.dieCutPerSqm)
    : cutType === 'straight' ? round2(printedSqm * p.cutPerSqm) : 0;
  const dieSetupCost = dieMode === 'new' ? p.dieCutSetupFee : 0;

  const totalCost = round2(materialCost + printCost + laminateCost + cutCost + dieSetupCost);
  const marginPct = p.margin[tier] ?? p.margin.retail;
  // ปัดขึ้นเป็นหลักสิบให้ราคาดูเป็นราคาขาย และไม่ต่ำกว่าราคาขั้นต่ำ
  const rawPrice = totalCost * (1 + marginPct / 100);
  const amount = Math.max(p.minJobPrice, Math.ceil(rawPrice / 10) * 10);
  const unitPrice = round2(amount / qty);

  return {
    spec: { materialId: material.id, materialName: material.name, widthCm, heightCm, qty, laminate, cutType, dieMode },
    pieceSqm: round2(pieceSqm * 10000) / 10000,
    printedSqm, usedSqm,
    cost: {
      material: materialCost, print: printCost, laminate: laminateCost,
      cut: cutCost, dieSetup: dieSetupCost, total: totalCost,
    },
    marginPct, tier,
    unitPrice, amount,
    profit: round2(amount - totalCost),
  };
}

/** Totals + tax lines for a document, honoring the VAT/WHT switches. */
export function docTotals(orgId, items, { discount = 0 } = {}) {
  const s = orgErpSettings(orgId);
  const subTotal = round2(items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0));
  const afterDiscount = round2(Math.max(0, subTotal - (Number(discount) || 0)));
  const vatAmount = s.vat.enabled ? round2(afterDiscount * (s.vat.rate / 100)) : 0;
  const whtAmount = s.wht.enabled ? round2(afterDiscount * (s.wht.rate / 100)) : 0;
  return {
    subTotal,
    discount: round2(Number(discount) || 0),
    vat: { enabled: s.vat.enabled, rate: s.vat.rate, amount: vatAmount },
    wht: { enabled: s.wht.enabled, rate: s.wht.rate, amount: whtAmount },
    grandTotal: round2(afterDiscount + vatAmount),
    netReceivable: round2(afterDiscount + vatAmount - whtAmount),
  };
}
