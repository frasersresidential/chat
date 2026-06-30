import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { scoreLead, analyzeNotes, gradeLetter, parseBudgetM, parseIncomeScore } from '../src/core/leadScoring.js';
import { parseSheet } from '../src/core/xlsx.js';
import { normalizeCoSaleRow, importLeads, listLeads, leadsSummary, clearLeads } from '../src/core/leads.js';

// ── Field parsers ──────────────────────────────────────────────────────────────
test('gradeLetter extracts the grade from "A : จอง"', () => {
  assert.equal(gradeLetter('A : จอง'), 'A');
  assert.equal(gradeLetter('C'), 'C');
  assert.equal(gradeLetter(''), null);
});

test('parseBudgetM returns the range midpoint in millions', () => {
  assert.equal(parseBudgetM('3.01 - 3.50'), 3.255);
  assert.equal(parseBudgetM('2.5'), 2.5);
  assert.equal(parseBudgetM(''), null);
});

test('parseIncomeScore scales income to 0..1 and understands "ล้าน"', () => {
  assert.ok(parseIncomeScore('มากกว่า 40,001') > 0.3);
  assert.equal(parseIncomeScore('2-3 ล้าน'), 1); // millions → capped at ceiling
  assert.equal(parseIncomeScore(''), null);
});

// ── Note analysis ───────────────────────────────────────────────────────────────
test('analyzeNotes detects decision timeframe and buying signals', () => {
  const a = analyzeNotes('ลูกค้าสนใจ จอง B87 ระยะเวลาตัดสินใจซื้อ : 1-3 เดือน โครงการที่เปรียบเทียบ : พฤกษา');
  assert.equal(a.decisionBucket, '1-3m');
  assert.ok(a.interested);
  assert.ok(a.comparing);
});

test('analyzeNotes flags a loan-approval concern', () => {
  const a = analyzeNotes('ลูกค้าเคยจองแล้วแต่กู้ไม่ผ่าน');
  assert.ok(a.loanConcern);
});

// ── Scoring ───────────────────────────────────────────────────────────────────
test('a booked, high-income, soon-to-decide lead scores hot', () => {
  const r = scoreLead({
    grading: 'A : จอง', stage: 'Closed Won', revisit: true,
    salary: 'มากกว่า 40,001', budget: '3.01 - 3.50', occupation: 'ธุรกิจส่วนตัว',
    leadSource: 'Walk-in', province: 'กรุงเทพมหานคร',
    notes: 'ลูกค้าสนใจ จอง ระยะเวลาตัดสินใจซื้อ : 1-3 เดือน',
  });
  assert.equal(r.tier, 'hot');
  assert.ok(r.score >= 70, `expected hot score, got ${r.score}`);
  assert.equal(r.converted, true);
});

test('a thin, low-grade, no-budget lead scores cold', () => {
  const r = scoreLead({ grading: 'F', stage: 'new', notes: 'ขอกลับไปคิดก่อน' });
  assert.equal(r.tier, 'cold');
  assert.ok(r.score < 45, `expected cold score, got ${r.score}`);
});

test('a live loan-approval problem caps the lead out of the hot tier', () => {
  const hot = scoreLead({ grading: 'A : จอง', stage: 'Closed Won', revisit: true, salary: 'มากกว่า 40,001', budget: '3.5', notes: 'สนใจมาก' });
  const capped = scoreLead({ grading: 'A : จอง', stage: 'Closed Won', revisit: true, salary: 'มากกว่า 40,001', budget: '3.5', notes: 'สนใจมากแต่กู้ไม่ผ่าน ติดบูโร' });
  assert.equal(hot.tier, 'hot');
  assert.notEqual(capped.tier, 'hot');
});

test('factors always sum within their declared max', () => {
  const r = scoreLead({ grading: 'A', stage: 'Closed Won', salary: 'มากกว่า 100,000', budget: '5' });
  for (const f of r.factors) assert.ok(f.points <= f.max, `${f.label} ${f.points} > ${f.max}`);
});

// ── CSV import round-trip ────────────────────────────────────────────────────────
test('parseSheet reads a CSV report with a banner above the header', () => {
  const csv = 'CoSale Report\n\nAccount Name,Stage,Grading,Budget,Salary\nสมชาย,Closed Won,A : จอง,3.01 - 3.50,มากกว่า 40001\nสมหญิง,new,F,,\n';
  const { headers, rows } = parseSheet(Buffer.from(csv), 'r.csv');
  assert.ok(headers.includes('Account Name'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Account Name'], 'สมชาย');
});

test('normalizeCoSaleRow maps fuzzy headers and merges note columns', () => {
  const lead = normalizeCoSaleRow({
    'Account Name: Account Name': 'สมชาย ใจดี', 'Mobile (Priority)': '0812345678',
    'Stage': 'Closed Won', 'Grading (Visit)': 'A : จอง', 'Budget': '3.01 - 3.50',
    'Province': 'กรุงเทพมหานคร', 'Work Province': 'นนทบุรี', 'Comments': 'สนใจมาก', 'Remark': 'จะกลับมา',
  });
  assert.equal(lead.customerName, 'สมชาย ใจดี');
  assert.equal(lead.mobile, '0812345678');
  assert.equal(lead.province, 'กรุงเทพมหานคร'); // not the Work Province
  assert.ok(lead.notes.includes('สนใจมาก') && lead.notes.includes('จะกลับมา'));
});

test('importLeads stores ranked, de-duplicated leads for an org', () => {
  clearLeads('org_test');
  const csv = [
    'Account Name,Mobile (Priority),Project Name (TH),Stage,Grading,Budget,Salary,Occupation,Province,Lead Source,Comments',
    'ลูกค้า A,0810000001,โครงการ X,Closed Won,A : จอง,3.5,มากกว่า 40001,ธุรกิจส่วนตัว,กรุงเทพมหานคร,Walk-in,สนใจมาก ระยะเวลาตัดสินใจซื้อ : 1-3 เดือน',
    'ลูกค้า B,0810000002,โครงการ X,new,F,,,,,,ขอกลับไปคิดก่อน',
  ].join('\n');
  const out = importLeads('org_test', Buffer.from(csv), 'r.csv');
  assert.equal(out.imported, 2);

  // Re-importing the same rows updates rather than duplicates.
  importLeads('org_test', Buffer.from(csv), 'r.csv');
  const leads = listLeads('org_test');
  assert.equal(leads.length, 2);
  assert.ok(leads[0].score >= leads[1].score, 'leads are ranked by score');

  const summary = leadsSummary('org_test');
  assert.equal(summary.total, 2);
  assert.ok(summary.tierCounts.hot >= 1);
  clearLeads('org_test');
});
