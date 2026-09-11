import { db } from '../store/db.js';

/**
 * Running document numbers (QT / JOB / INV / RC), per org per year, backed by
 * the store's persistent cursor mechanism so they survive restarts and never
 * repeat: QT-2026-0001, JOB-2026-0042, …
 */
export function nextDocNumber(orgId, type) {
  const year = new Date().getFullYear();
  const key = `erp_${orgId}_${type}_${year}`;
  const seq = (db.getCursor(key) < 0 ? 0 : db.getCursor(key)) + 1;
  db.setCursor(key, seq);
  return `${type}-${year}-${String(seq).padStart(4, '0')}`;
}
