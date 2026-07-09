import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { seedIfEmpty } from '../src/store/seed.js';
import { draw, publicCampaign, remainingPlays, campaignStats, campaignReport, sanitizeTheme, sanitizeCampaign, THEME_PRESETS, enterGate, hasEntered } from '../src/core/games.js';

db._reset();
seedIfEmpty();

const campaign = () => db.gameCampaigns.get('game_lucky_draw');

test('seed creates the demo lucky-draw campaign as a single-game wheel', () => {
  const c = campaign();
  assert.ok(c);
  assert.equal(c.game, 'wheel');
  assert.equal(publicCampaign(c).game, 'wheel');
  assert.ok(c.prizes.length >= 3);
});

test('public view never leaks weights or stock counts', () => {
  const view = publicCampaign(campaign());
  for (const p of view.prizes) {
    assert.equal(p.weight, undefined);
    assert.equal(p.stock, undefined);
  }
});

// The seeded campaign gates on a code, so register these players first.
// Each player gets a distinct phone (one play per phone number is enforced).
let phoneSeq = 700000000;
const enter = (id, phone) => enterGate({ campaign: campaign(), playerId: id, name: 'ผู้เล่น', phone: phone || String(phoneSeq++), project: 'The Rich รัชดา', plot: 'A-1', code: 'FP2024' });

test('a draw returns a prize from the pool and flavour matches the game', () => {
  enter('p1');
  const wheel = draw({ campaign: campaign(), playerId: 'p1', game: 'wheel' });
  assert.ok(!wheel.error);
  assert.ok(campaign().prizes.some((p) => p.id === wheel.prize.id));
  assert.equal(wheel.fortune, null);
  assert.ok(wheel.prizeIndex >= 0);

  // Each game lives on its own single-game campaign/link.
  const sticksC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'ส', active: true, game: 'sticks', limitPerDay: 9,
    prizes: [{ id: 'a', label: 'x', win: true, weight: 1, stock: null }],
  });
  const sticks = draw({ campaign: sticksC, playerId: 'p2', game: 'sticks' });
  assert.equal(sticks.fortune.type, 'siamsi');
  assert.ok(sticks.fortune.number >= 1);

  const cardsC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'ค', active: true, game: 'cards', limitPerDay: 9,
    prizes: [{ id: 'a', label: 'x', win: true, weight: 1, stock: null }],
  });
  const cards = draw({ campaign: cardsC, playerId: 'p3', game: 'cards' });
  assert.equal(cards.fortune.type, 'tarot');
  assert.ok(cards.fortune.name);

  // A single-game campaign rejects a different game type.
  assert.equal(draw({ campaign: cardsC, playerId: 'p3', game: 'wheel' }).error, 'unknown_game');
});

test('winning draws get a coupon code, losing draws do not', () => {
  // Force a guaranteed win, then a guaranteed loss, via single-prize campaigns.
  const winC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'w', active: true, game: 'wheel', limitPerDay: 99,
    prizes: [{ id: 'a', label: 'ส่วนลด', win: true, weight: 1, stock: null, couponPrefix: 'TEST' }],
  });
  const r1 = draw({ campaign: winC, playerId: 'p4', game: 'wheel' });
  assert.match(r1.couponCode, /^TEST-[A-Z2-9]{6}$/);

  const loseC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'l', active: true, game: 'wheel', limitPerDay: 99,
    prizes: [{ id: 'b', label: 'เสียใจด้วย', win: false, weight: 1, stock: null }],
  });
  const r2 = draw({ campaign: loseC, playerId: 'p4', game: 'wheel' });
  assert.equal(r2.couponCode, null);
  assert.equal(r2.prize.win, false);
});

test('one play per phone number (any device)', () => {
  enter('ph1', '0899990001');
  assert.ok(!draw({ campaign: campaign(), playerId: 'ph1', game: 'wheel' }).error);
  assert.equal(remainingPlays(campaign(), 'ph1'), 0);
  // Same phone drawing again is blocked...
  assert.equal(draw({ campaign: campaign(), playerId: 'ph1', game: 'wheel' }).error, 'phone_used');
  // ...even from a different device / playerId (re-registration is refused).
  assert.equal(
    enterGate({ campaign: campaign(), playerId: 'ph1b', name: 'x', phone: '0899990001', project: 'p', plot: '1', code: 'FP2024' }).error,
    'phone_used');
  // A different phone can still play.
  enter('ph2', '0899990002');
  assert.ok(!draw({ campaign: campaign(), playerId: 'ph2', game: 'wheel' }).error);
});

test('phone is stored as digits only and length-validated', () => {
  const ok = enterGate({ campaign: campaign(), playerId: 'fmt1', name: 'ก', phone: '081-234-5678', project: 'p', plot: '1', code: 'FP2024' });
  assert.ok(ok.ok);
  assert.equal(draw({ campaign: campaign(), playerId: 'fmt1', game: 'wheel' }).error, undefined);
  // too short after stripping symbols
  assert.equal(enterGate({ campaign: campaign(), playerId: 'fmt2', name: 'ก', phone: '12-34', project: 'p', plot: '1', code: 'FP2024' }).error, 'bad_phone');
});

test('finite stock decrements and empty pools stop paying out', () => {
  const c = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 's', active: true, game: 'cards', limitPerDay: 99,
    prizes: [{ id: 'rare', label: 'รางวัลใหญ่', win: true, weight: 1, stock: 2 }],
  });
  assert.ok(!draw({ campaign: db.gameCampaigns.get(c.id), playerId: 'p5', game: 'cards' }).error);
  assert.ok(!draw({ campaign: db.gameCampaigns.get(c.id), playerId: 'p5', game: 'cards' }).error);
  assert.equal(db.gameCampaigns.get(c.id).prizes[0].stock, 0);
  assert.equal(draw({ campaign: db.gameCampaigns.get(c.id), playerId: 'p5', game: 'cards' }).error, 'no_prizes');
});

test('inactive campaigns and unknown games are rejected', () => {
  assert.equal(draw({ campaign: { ...campaign(), active: false }, playerId: 'p6', game: 'wheel' }).error, 'campaign_inactive');
  assert.equal(draw({ campaign: campaign(), playerId: 'p6', game: 'slot' }).error, 'unknown_game');
  assert.equal(draw({ campaign: campaign(), playerId: '', game: 'wheel' }).error, 'bad_player');
});

test('theme: sanitize falls back to preset for bad values and keeps overrides', () => {
  const t = sanitizeTheme({ preset: 'pop', colors: { accent: '#123abc', bg: 'not-a-color' }, style: { radius: 999, shadow: 'sparkly' } });
  assert.equal(t.preset, 'pop');
  assert.equal(t.colors.accent, '#123abc');                       // valid override kept
  assert.equal(t.colors.bg, THEME_PRESETS.pop.colors.bg);         // invalid → preset value
  assert.equal(t.style.radius, 32);                               // clamped
  assert.equal(t.style.shadow, THEME_PRESETS.pop.style.shadow);   // invalid → preset value
});

test('theme: survives a campaign save round-trip and reaches the public view', () => {
  const saved = sanitizeCampaign({ name: 'themed', theme: { preset: 'luxe', colors: { highlight: '#ffeecc' } } }, 'org_company_a');
  assert.equal(saved.theme.preset, 'luxe');
  assert.equal(saved.theme.colors.highlight, '#ffeecc');
  const row = db.gameCampaigns.insert(saved);
  const view = publicCampaign(row);
  assert.equal(view.theme.colors.highlight, '#ffeecc');
  assert.equal(view.theme.style.shadow, THEME_PRESETS.luxe.style.shadow);
});

test('gate: public view exposes projects but never the access code', () => {
  const view = publicCampaign(campaign());
  assert.equal(view.gate.enabled, true);
  assert.ok(view.gate.projects.length > 0);
  assert.equal(view.gate.code, undefined);
});

test('gate: wrong code is rejected, correct code records the entry', () => {
  const bad = enterGate({ campaign: campaign(), playerId: 'g1', name: 'สมชาย ใจดี', phone: '0800000000', project: 'The Rich รัชดา', plot: 'A-12', code: 'nope' });
  assert.equal(bad.error, 'bad_code');
  assert.equal(hasEntered('game_lucky_draw', 'g1'), false);

  const ok = enterGate({ campaign: campaign(), playerId: 'g1', name: 'สมชาย ใจดี', phone: '0800000000', project: 'The Rich รัชดา', plot: 'A-12', code: 'fp2024' });
  assert.ok(ok.ok);
  assert.equal(hasEntered('game_lucky_draw', 'g1'), true);
});

test('gate: name and phone are required', () => {
  assert.equal(enterGate({ campaign: campaign(), playerId: 'g2', name: '  ', phone: '0812345678', code: 'FP2024' }).error, 'missing_name');
  assert.equal(enterGate({ campaign: campaign(), playerId: 'g2', name: 'สมหญิง', phone: '', code: 'FP2024' }).error, 'missing_phone');
});

test('gate: draw is blocked until the player passes the gate', () => {
  assert.equal(draw({ campaign: campaign(), playerId: 'g3', game: 'wheel' }).error, 'gate_required');
  enterGate({ campaign: campaign(), playerId: 'g3', name: 'ทดสอบ', phone: '0898887777', project: 'Neo Home บางนา', plot: 'B-3', code: 'FP2024' });
  assert.ok(!draw({ campaign: campaign(), playerId: 'g3', game: 'wheel' }).error);
});

test('gate: sanitizeCampaign keeps projects list and trims the code', () => {
  const saved = sanitizeCampaign({ name: 'g', gate: { enabled: true, code: '  ABC1 ', projects: ['P1', ' P2 ', ''] } }, 'org_company_a');
  assert.equal(saved.gate.enabled, true);
  assert.equal(saved.gate.code, 'ABC1');
  assert.deepEqual(saved.gate.projects, ['P1', 'P2']);
});

test('locked-prize link always awards the chosen prize every play', () => {
  const c = db.gameCampaigns.insert(sanitizeCampaign({
    name: 'ลิงก์รางวัล 100,000', game: 'wheel',
    forcedPrizeId: 'p100k',
    prizes: [
      { id: 'p100k', label: 'รางวัล 100,000', win: true, weight: 1, stock: 3, couponPrefix: 'M100K' },
      { id: 'psmall', label: 'ของที่ระลึก', win: true, weight: 999, stock: null },
      { id: 'plose', label: 'ขอบคุณ', win: false, weight: 999, stock: null },
    ],
  }, 'org_company_a'));
  assert.equal(c.forcedPrizeId, 'p100k');
  // Even with tiny weight, the locked prize comes out every time.
  for (let i = 0; i < 8; i++) {
    const r = draw({ campaign: db.gameCampaigns.get(c.id), playerId: 'lock' + i, game: 'wheel' });
    assert.equal(r.prize.label, 'รางวัล 100,000');
    assert.match(r.couponCode, /^M100K-/);
  }
  // Locked prize is treated as unlimited — stock isn't drained below its start.
  assert.equal(db.gameCampaigns.get(c.id).prizes.find((p) => p.id === 'p100k').stock, 3);
});

test('clearing the lock returns to weighted random', () => {
  const base = sanitizeCampaign({ name: 'x', forcedPrizeId: 'a', prizes: [{ id: 'a', label: 'A', win: true, weight: 1 }] }, 'org_company_a');
  assert.equal(base.forcedPrizeId, 'a');
  const cleared = sanitizeCampaign({ name: 'x', forcedPrizeId: '', prizes: [{ id: 'a', label: 'A', win: true, weight: 1 }] }, 'org_company_a', base);
  assert.equal(cleared.forcedPrizeId, null);
  // An id that doesn't exist in prizes is rejected.
  const bad = sanitizeCampaign({ name: 'x', forcedPrizeId: 'ghost', prizes: [{ id: 'a', label: 'A', win: true, weight: 1 }] }, 'org_company_a');
  assert.equal(bad.forcedPrizeId, null);
});

test('report lists registrants with the prize they won, incl. not-yet-played', () => {
  const rc = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'r', active: true, game: 'wheel', limitPerDay: 1,
    gate: { enabled: true, code: 'RPT', projects: [] },
    prizes: [{ id: 'big', label: 'ทองคำ', win: true, weight: 1, stock: null, couponPrefix: 'GOLD' }],
  });
  // Two register; only one spins.
  enterGate({ campaign: rc, playerId: 'r1', name: 'ผู้เล่นหนึ่ง', phone: '0811111111', project: 'โครงการ A', plot: 'A-1', code: 'RPT' });
  enterGate({ campaign: rc, playerId: 'r2', name: 'ผู้เล่นสอง', phone: '0822222222', project: 'โครงการ B', plot: 'B-2', code: 'RPT' });
  draw({ campaign: db.gameCampaigns.get(rc.id), playerId: 'r1', game: 'wheel' });

  const rows = campaignReport(db.gameCampaigns.get(rc.id));
  assert.equal(rows.length, 2);
  const played = rows.find((x) => x.phone === '0811111111');
  const notYet = rows.find((x) => x.phone === '0822222222');
  assert.equal(played.played, true);
  assert.equal(played.prize, 'ทองคำ');
  assert.match(played.couponCode, /^GOLD-/);
  assert.equal(played.name, 'ผู้เล่นหนึ่ง');
  assert.equal(notYet.played, false);
  assert.equal(notYet.prize, null);
});

test('campaign stats aggregate draws', () => {
  const stats = campaignStats('game_lucky_draw');
  assert.ok(stats.totalDraws > 0);
  assert.ok(stats.uniquePlayers >= 3);
});
