import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store.js';
import {
  addCompetitor, listCompetitors, refreshCompetitor, seedIfEmpty, listAds,
  winningAds, toggleSaved, insights, daysRunning, winScore, liveEnabled,
} from '../src/core.js';

db._reset();
await seedIfEmpty();

test('mock mode is active without a token', () => {
  assert.equal(liveEnabled(), false);
});

test('seed populates the watchlist with active ads', () => {
  const list = listCompetitors();
  assert.ok(list.length >= 3);
  const sansiri = list.find((c) => c.pageName === 'Sansiri');
  assert.ok(sansiri);
  assert.ok(sansiri.activeAds > 0, 'seeded competitor should have active ads');
  assert.ok(sansiri.longestRunning >= sansiri.avgDaysRunning);
});

test('refresh is idempotent — same ads are not duplicated', async () => {
  const c = listCompetitors().find((c) => c.pageName === 'Sansiri');
  const before = db.ads.filter((a) => a.competitorId === c.id).length;
  const { newAds } = await refreshCompetitor(db.competitors.get(c.id));
  const after = db.ads.filter((a) => a.competitorId === c.id).length;
  assert.equal(newAds.length, 0, 'stable mock set yields no new ads on re-fetch');
  assert.equal(before, after);
});

test('adding a new competitor fetches and stores its ads', async () => {
  const c = addCompetitor({ pageName: 'Origin Property', pageId: '999' });
  await refreshCompetitor(c);
  const ads = db.ads.filter((a) => a.competitorId === c.id);
  assert.ok(ads.length >= 5);
});

test('duplicate competitor names are rejected', () => {
  assert.throws(() => addCompetitor({ pageName: 'Sansiri' }));
});

test('winning ads are sorted by longevity and only include active', () => {
  const win = winningAds(10);
  assert.ok(win.length > 0);
  for (const ad of win) assert.equal(ad.status, 'active');
  for (let i = 1; i < win.length; i++) {
    assert.ok(win[i - 1].winScore >= win[i].winScore, 'descending by win score');
  }
});

test('winScore rewards long-running active ads over stopped ones', () => {
  const old = { startDate: new Date(Date.now() - 100 * 86400000).toISOString(), status: 'active' };
  const stopped = { startDate: new Date(Date.now() - 100 * 86400000).toISOString(), status: 'inactive' };
  assert.ok(daysRunning(old) >= 99);
  assert.ok(winScore(old) > winScore(stopped));
});

test('saving an ad puts it in the swipe file', () => {
  const ad = listAds()[0];
  toggleSaved(db.ads.get(ad.id), { saved: true, tags: ['hook', 'discount'] });
  const saved = listAds({ saved: true });
  assert.ok(saved.find((a) => a.id === ad.id));
  assert.deepEqual(db.ads.get(ad.id).savedTags, ['hook', 'discount']);
});

test('search filters ads by copy text', () => {
  const hits = listAds({ q: 'คอนโด' });
  for (const ad of hits) {
    assert.ok(`${ad.headline} ${ad.body} ${ad.cta} ${ad.pageName}`.includes('คอนโด'));
  }
});

test('insights aggregate creative intelligence', () => {
  const ins = insights();
  assert.ok(ins.totalAds > 0);
  assert.ok(Array.isArray(ins.topWords) && ins.topWords.length > 0);
  assert.ok(Array.isArray(ins.ctas));
  assert.ok(Array.isArray(ins.platforms));
  const total = ins.longevity['0-7'] + ins.longevity['8-30'] + ins.longevity['31-90'] + ins.longevity['90+'];
  assert.equal(total, ins.totalAds, 'every ad falls into exactly one longevity bucket');
});
