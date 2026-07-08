import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { seedIfEmpty } from '../src/store/seed.js';
import { draw, publicCampaign, remainingToday, campaignStats, sanitizeTheme, sanitizeCampaign, THEME_PRESETS } from '../src/core/games.js';

db._reset();
seedIfEmpty();

const campaign = () => db.gameCampaigns.get('game_lucky_draw');

test('seed creates the demo lucky-draw campaign with all three games', () => {
  const c = campaign();
  assert.ok(c);
  assert.deepEqual(c.games, ['wheel', 'sticks', 'cards']);
  assert.ok(c.prizes.length >= 3);
});

test('public view never leaks weights or stock counts', () => {
  const view = publicCampaign(campaign());
  for (const p of view.prizes) {
    assert.equal(p.weight, undefined);
    assert.equal(p.stock, undefined);
  }
});

test('a draw returns a prize from the pool and flavour matches the game', () => {
  const wheel = draw({ campaign: campaign(), playerId: 'p1', game: 'wheel' });
  assert.ok(!wheel.error);
  assert.ok(campaign().prizes.some((p) => p.id === wheel.prize.id));
  assert.equal(wheel.fortune, null);
  assert.ok(wheel.prizeIndex >= 0);

  const sticks = draw({ campaign: campaign(), playerId: 'p2', game: 'sticks' });
  assert.equal(sticks.fortune.type, 'siamsi');
  assert.ok(sticks.fortune.number >= 1);

  const cards = draw({ campaign: campaign(), playerId: 'p3', game: 'cards' });
  assert.equal(cards.fortune.type, 'tarot');
  assert.ok(cards.fortune.name);
});

test('winning draws get a coupon code, losing draws do not', () => {
  // Force a guaranteed win, then a guaranteed loss, via single-prize campaigns.
  const winC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'w', active: true, games: ['wheel'], limitPerDay: 99,
    prizes: [{ id: 'a', label: 'ส่วนลด', win: true, weight: 1, stock: null, couponPrefix: 'TEST' }],
  });
  const r1 = draw({ campaign: winC, playerId: 'p4', game: 'wheel' });
  assert.match(r1.couponCode, /^TEST-[A-Z2-9]{6}$/);

  const loseC = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 'l', active: true, games: ['wheel'], limitPerDay: 99,
    prizes: [{ id: 'b', label: 'เสียใจด้วย', win: false, weight: 1, stock: null }],
  });
  const r2 = draw({ campaign: loseC, playerId: 'p4', game: 'wheel' });
  assert.equal(r2.couponCode, null);
  assert.equal(r2.prize.win, false);
});

test('daily play limit is enforced per player', () => {
  const c = campaign();
  const limit = c.limitPerDay;
  for (let i = 0; i < limit; i++) {
    assert.ok(!draw({ campaign: campaign(), playerId: 'limited', game: 'wheel' }).error);
  }
  assert.equal(remainingToday(campaign(), 'limited'), 0);
  assert.equal(draw({ campaign: campaign(), playerId: 'limited', game: 'wheel' }).error, 'daily_limit');
  // Other players are unaffected.
  assert.ok(!draw({ campaign: campaign(), playerId: 'someone_else', game: 'wheel' }).error);
});

test('finite stock decrements and empty pools stop paying out', () => {
  const c = db.gameCampaigns.insert({
    organizationId: 'org_company_a', name: 's', active: true, games: ['cards'], limitPerDay: 99,
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

test('campaign stats aggregate draws', () => {
  const stats = campaignStats('game_lucky_draw');
  assert.ok(stats.totalDraws > 0);
  assert.ok(stats.uniquePlayers >= 3);
});
