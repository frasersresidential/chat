import { db } from './store.js';
import { broadcastPush } from './push.js';
import { config } from './config.js';
import { logger } from './logger.js';

const log = logger('core');

/**
 * Facebook / Meta competitor ad-spy core.
 *
 * Legitimate competitive intelligence built on the public **Meta Ad Library
 * API** (`graph.facebook.com/…/ads_archive`) — not scraping. Two modes, chosen
 * automatically:
 *
 *   • LIVE  — when `META_AD_LIBRARY_TOKEN` is set, we query the real Ad Library.
 *   • MOCK  — otherwise we generate a stable, deterministic demo dataset so the
 *             whole dashboard is explorable with zero credentials.
 *
 * What the Ad Library exposes for ordinary commercial ads is *creative
 * intelligence*: the ad copy, media, CTA, destination, which platforms it runs
 * on and — crucially — how long it has been running. Spend / impressions are
 * only published for political & social-issue ads, so this tool never pretends
 * to know a competitor's budget.
 */

const DAY = 86400000;
const GRAPH_VERSION = 'v19.0';

/** LIVE when an Ad Library access token is configured. */
export const liveEnabled = () => !!config.adLibraryToken;

// ── Derived metrics ───────────────────────────────────────────────────────────
export const daysRunning = (ad) =>
  Math.max(0, Math.floor((Date.now() - new Date(ad.startDate).getTime()) / DAY));

/**
 * "Winning" heuristic: an ad a competitor keeps paying to run is one that is
 * probably profitable. Longevity dominates; still-active ads score higher than
 * ones that have since stopped.
 */
export const winScore = (ad) => daysRunning(ad) * (ad.status === 'active' ? 1 : 0.4);

/** Attach computed fields the UI needs so it never recomputes server truth. */
export function decorateAd(ad) {
  return { ...ad, daysRunning: daysRunning(ad), winScore: Math.round(winScore(ad)) };
}

// ── Watchlist CRUD ─────────────────────────────────────────────────────────────
export function listCompetitors() {
  return db.competitors.all()
    .map((c) => ({ ...c, ...competitorStats(c.id) }))
    .sort((a, b) => (a.pageName || '').localeCompare(b.pageName || ''));
}

/** Roll-up stats shown on each watchlist row. */
export function competitorStats(competitorId) {
  const ads = db.ads.filter((a) => a.competitorId === competitorId);
  const active = ads.filter((a) => a.status === 'active');
  const now = Date.now();
  const newThisWeek = ads.filter((a) => now - new Date(a.firstFetchedAt || a.createdAt).getTime() < 7 * DAY).length;
  const longest = active.reduce((m, a) => Math.max(m, daysRunning(a)), 0);
  const avg = active.length
    ? Math.round(active.reduce((s, a) => s + daysRunning(a), 0) / active.length)
    : 0;
  return { activeAds: active.length, totalAds: ads.length, newThisWeek, longestRunning: longest, avgDaysRunning: avg };
}

export function addCompetitor({ pageName, pageId, country }) {
  const name = String(pageName || '').trim();
  if (!name) throw new Error('pageName required');
  const existing = db.competitors.find(
    (c) => c.pageName.toLowerCase() === name.toLowerCase() || (pageId && c.pageId === pageId),
  );
  if (existing) throw new Error('คู่แข่งรายนี้อยู่ในรายการเฝ้าดูแล้ว');
  return db.competitors.insert({
    pageName: name,
    pageId: String(pageId || '').trim() || null,
    country: String(country || config.defaultCountry || 'TH').toUpperCase().slice(0, 2),
    alertsEnabled: true,
    lastCheckedAt: null,
  });
}

export function updateCompetitor(competitor, patch) {
  const p = {};
  if (patch.pageName !== undefined) p.pageName = String(patch.pageName).trim() || competitor.pageName;
  if (patch.pageId !== undefined) p.pageId = String(patch.pageId).trim() || null;
  if (patch.country !== undefined) p.country = String(patch.country).toUpperCase().slice(0, 2);
  if (patch.alertsEnabled !== undefined) p.alertsEnabled = !!patch.alertsEnabled;
  return db.competitors.update(competitor.id, p);
}

export function removeCompetitor(competitor) {
  db.ads.filter((a) => a.competitorId === competitor.id).forEach((a) => db.ads.remove(a.id));
  db.competitors.remove(competitor.id);
}

// ── Ad feed / swipe file ────────────────────────────────────────────────────────
export function listAds({ competitorId, status, saved, q, sort } = {}) {
  let ads = db.ads.all();
  if (competitorId) ads = ads.filter((a) => a.competitorId === competitorId);
  if (status && status !== 'all') ads = ads.filter((a) => a.status === status);
  if (saved === true || saved === 'true') ads = ads.filter((a) => a.saved);
  if (q) {
    const needle = String(q).toLowerCase();
    ads = ads.filter((a) =>
      `${a.headline} ${a.body} ${a.cta} ${a.pageName}`.toLowerCase().includes(needle));
  }
  const decorated = ads.map(decorateAd);
  const sorters = {
    longest: (a, b) => b.daysRunning - a.daysRunning,
    newest: (a, b) => new Date(b.firstFetchedAt || b.createdAt) - new Date(a.firstFetchedAt || a.createdAt),
    winning: (a, b) => b.winScore - a.winScore,
  };
  return decorated.sort(sorters[sort] || sorters.longest);
}

export function winningAds(limit = 24) {
  return listAds({ status: 'active', sort: 'winning' }).slice(0, limit);
}

export function toggleSaved(ad, { saved, tags } = {}) {
  const patch = {};
  if (saved !== undefined) patch.saved = !!saved;
  if (Array.isArray(tags)) patch.savedTags = tags.map((t) => String(t).trim()).filter(Boolean);
  return decorateAd(db.ads.update(ad.id, patch));
}

// ── Copy / creative insights ────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'with', 'our', 'are', 'get', 'now', 'this', 'that',
  'from', 'have', 'was', 'all', 'can', 'out', 'new', 'has', 'ที่', 'และ', 'ให้', 'ได้', 'ใน',
  'เป็น', 'กับ', 'ของ', 'มี', 'จาก', 'ไม่', 'จะ', 'นี้', 'คุณ', 'ก็', 'แล้ว', 'เรา', 'มาก',
]);

/**
 * Aggregate creative intelligence across a competitor's ads (or the whole
 * watchlist): the words / hooks they lean on, the CTAs and platforms they
 * favour, how their creatives split by media type & longevity, and their
 * launch cadence.
 */
export function insights(competitorId) {
  let ads = db.ads.all();
  if (competitorId) ads = ads.filter((a) => a.competitorId === competitorId);

  const words = {}, ctas = {}, platforms = {}, mediaTypes = {}, cadence = {};
  const buckets = { '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 };
  const hooks = {};

  for (const ad of ads) {
    for (const tok of `${ad.headline || ''} ${ad.body || ''}`
      .toLowerCase().split(/[\s,.!?()/\-–—"'“”|:;]+/)) {
      if (tok.length < 2 || STOPWORDS.has(tok) || /^\d+$/.test(tok)) continue;
      words[tok] = (words[tok] || 0) + 1;
    }
    // The opening line of the body is the "hook".
    const firstLine = String(ad.body || ad.headline || '').split('\n')[0].trim().slice(0, 80);
    if (firstLine) hooks[firstLine] = (hooks[firstLine] || 0) + 1;
    if (ad.cta) ctas[ad.cta] = (ctas[ad.cta] || 0) + 1;
    for (const p of ad.platforms || []) platforms[p] = (platforms[p] || 0) + 1;
    if (ad.mediaType) mediaTypes[ad.mediaType] = (mediaTypes[ad.mediaType] || 0) + 1;
    const d = daysRunning(ad);
    buckets[d <= 7 ? '0-7' : d <= 30 ? '8-30' : d <= 90 ? '31-90' : '90+']++;
    const month = String(ad.startDate || '').slice(0, 7);
    if (month) cadence[month] = (cadence[month] || 0) + 1;
  }

  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([label, count]) => ({ label, count }));

  return {
    totalAds: ads.length,
    activeAds: ads.filter((a) => a.status === 'active').length,
    topWords: top(words, 25),
    topHooks: top(hooks, 6),
    ctas: top(ctas, 10),
    platforms: top(platforms, 10),
    mediaTypes: top(mediaTypes, 5),
    longevity: buckets,
    cadence: Object.entries(cadence).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count })),
  };
}

// ── Refresh: fetch → diff → alert ────────────────────────────────────────────────
/**
 * Fetch a competitor's current active ads (live or mock), upsert them, and —
 * for genuinely new ads — broadcast a Web Push alert so a fresh competitor
 * campaign never goes unnoticed.
 */
export async function refreshCompetitor(competitor) {
  let incoming = [];
  try {
    incoming = liveEnabled() ? await fetchFromLibrary(competitor) : generateMockAds(competitor);
  } catch (e) {
    log.warn(`refresh ${competitor.pageName} failed: ${e.message}`);
    db.competitors.update(competitor.id, { lastCheckedAt: new Date().toISOString(), lastError: e.message });
    return { newAds: [], error: e.message };
  }

  const existing = db.ads.filter((a) => a.competitorId === competitor.id);
  const byExternal = new Map(existing.map((a) => [a.externalId, a]));
  const seen = new Set();
  const newAds = [];
  const nowIso = new Date().toISOString();

  for (const ad of incoming) {
    seen.add(ad.externalId);
    const prev = byExternal.get(ad.externalId);
    if (prev) {
      db.ads.update(prev.id, { ...ad, id: prev.id, status: 'active', lastSeenActive: nowIso });
    } else {
      const row = db.ads.insert({
        competitorId: competitor.id,
        ...ad,
        status: 'active',
        saved: false,
        savedTags: [],
        firstFetchedAt: nowIso,
        lastSeenActive: nowIso,
      });
      newAds.push(row);
    }
  }
  // Ads we've stored but no longer see → mark inactive (they stopped running).
  for (const a of existing) {
    if (!seen.has(a.externalId) && a.status === 'active') {
      db.ads.update(a.id, { status: 'inactive' });
    }
  }

  db.competitors.update(competitor.id, { lastCheckedAt: nowIso, lastError: null });

  if (newAds.length && competitor.alertsEnabled) {
    const first = newAds[0];
    const preview = String(first.headline || first.body || '').slice(0, 60);
    broadcastPush({
      title: `🕵️ ${competitor.pageName} ปล่อยโฆษณาใหม่ ${newAds.length} ชิ้น`,
      body: preview ? `“${preview}”` : 'มีครีเอทีฟใหม่ในคลังโฆษณา Facebook',
    });
  }
  if (newAds.length) log.info(`${competitor.pageName}: ${newAds.length} new ad(s)`);
  return { newAds, error: null };
}

export async function refreshAll() {
  const results = [];
  for (const c of db.competitors.all()) {
    results.push({ competitorId: c.id, ...(await refreshCompetitor(c)) });
  }
  return results;
}

// ── LIVE adapter: Meta Ad Library API ────────────────────────────────────────────
async function fetchFromLibrary(competitor) {
  if (!competitor.pageId) throw new Error('ต้องมี Page ID เพื่อดึงจาก Ad Library จริง');
  const fields = [
    'id', 'page_name', 'ad_creative_bodies', 'ad_creative_link_titles',
    'ad_creative_link_captions', 'ad_creative_link_descriptions',
    'ad_delivery_start_time', 'ad_snapshot_url', 'publisher_platforms',
  ].join(',');
  const params = new URLSearchParams({
    search_page_ids: competitor.pageId,
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    ad_reached_countries: JSON.stringify([competitor.country || 'TH']),
    fields,
    limit: '50',
    access_token: config.adLibraryToken,
  });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/ads_archive?${params}`);
  if (!res.ok) throw new Error(`Ad Library ${res.status}`);
  const { data = [] } = await res.json();
  return data.map((d) => ({
    externalId: d.id,
    pageName: d.page_name || competitor.pageName,
    headline: (d.ad_creative_link_titles || [])[0] || '',
    body: (d.ad_creative_bodies || [])[0] || '',
    cta: (d.ad_creative_link_captions || [])[0] || '',
    linkUrl: (d.ad_creative_link_captions || [])[0] || '',
    mediaType: 'unknown',
    imageColor: null,
    platforms: d.publisher_platforms || [],
    snapshotUrl: d.ad_snapshot_url || null,
    startDate: d.ad_delivery_start_time || new Date().toISOString(),
  }));
}

// ── MOCK adapter: deterministic demo dataset ─────────────────────────────────────
const MOCK_HEADLINES = [
  'จองวันนี้ รับส่วนลดสูงสุด 300,000฿', 'คอนโดติดรถไฟฟ้า เริ่ม 1.99 ล้าน',
  'ผ่อนเริ่มต้น 3,900/เดือน อยู่ฟรี 2 ปี', 'Penthouse วิวแม่น้ำ ยูนิตสุดท้าย',
  'บ้านเดี่ยวหลังใหญ่ ฟรีค่าโอน', 'เปิดจองเฟสใหม่ ราคาพิเศษเฉพาะสัปดาห์นี้',
  'ทาวน์โฮมใจกลางเมือง พร้อมอยู่', 'รับข้อเสนอพิเศษ นัดชมโครงการวันนี้',
];
const MOCK_BODIES = [
  'ทำเลศักยภาพใกล้ทุกความสะดวก เดินทางง่าย ใกล้รถไฟฟ้าเพียง 200 เมตร ลงทะเบียนรับสิทธิพิเศษก่อนใคร',
  'ดีไซน์ใหม่ ฟังก์ชันครบ ส่วนกลางระดับลักชัวรี สระว่ายน้ำ ฟิตเนส co-working space ทักแชทรับโปรทันที',
  'โปรแรงสุดในรอบปี ฟรีทุกค่าใช้จ่ายวันโอน พร้อมของแถมเต็มบ้าน จำนวนจำกัด รีบจองก่อนหมด',
  'ผ่อนสบายกว่าเช่า เป็นเจ้าของได้ง่ายกว่าที่คิด นัดเข้าชมห้องตัวอย่างวันนี้ รับข้อเสนอสุดพิเศษ',
];
const MOCK_CTAS = ['ส่งข้อความ', 'ดูข้อมูลเพิ่มเติม', 'ลงทะเบียน', 'จองเลย', 'โทรเลย'];
const MOCK_PLATFORMS = [
  ['facebook'], ['facebook', 'instagram'], ['facebook', 'instagram', 'messenger'],
  ['instagram'], ['facebook', 'audience_network'],
];
const MOCK_MEDIA = ['image', 'video', 'carousel'];
const MOCK_COLORS = ['#1f6feb', '#7c5cff', '#2ea043', '#db8b00', '#da3633', '#0aa2c0'];

/** Small deterministic hash so the same competitor always yields the same ads. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function generateMockAds(competitor) {
  const seed = hash(competitor.id + (competitor.pageName || ''));
  const count = 5 + (seed % 5); // 5–9 ads
  const ads = [];
  for (let i = 0; i < count; i++) {
    const s = hash(`${competitor.id}:${i}`);
    const startedDaysAgo = 2 + (s % 130); // 2–131 days running
    ads.push({
      externalId: `mock_${competitor.id}_${i}`,
      pageName: competitor.pageName,
      headline: MOCK_HEADLINES[s % MOCK_HEADLINES.length],
      body: MOCK_BODIES[(s >>> 3) % MOCK_BODIES.length],
      cta: MOCK_CTAS[(s >>> 5) % MOCK_CTAS.length],
      linkUrl: `https://example.com/${competitor.pageId || 'page'}/lp${i}`,
      mediaType: MOCK_MEDIA[(s >>> 7) % MOCK_MEDIA.length],
      imageColor: MOCK_COLORS[(s >>> 9) % MOCK_COLORS.length],
      platforms: MOCK_PLATFORMS[(s >>> 11) % MOCK_PLATFORMS.length],
      snapshotUrl: null,
      startDate: new Date(Date.now() - startedDaysAgo * DAY).toISOString(),
    });
  }
  return ads;
}

// ── Demo seed ─────────────────────────────────────────────────────────────────
/** First boot with an empty store: watch a few demo pages so the UI has data. */
export async function seedIfEmpty() {
  if (!db.isEmpty() || liveEnabled()) return;
  log.info('seeding demo watchlist...');
  for (const [pageName, pageId] of [
    ['Sansiri', '112233445566'],
    ['AP Thailand', '223344556677'],
    ['LPN Development', '334455667788'],
  ]) {
    await refreshCompetitor(addCompetitor({ pageName, pageId }));
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
let timer = null;
/** Periodically refresh every watched competitor so new ads surface on their own. */
export function startScheduler(intervalMs = config.refreshHours * 3600 * 1000) {
  if (timer) return;
  timer = setInterval(() => {
    refreshAll().catch((e) => log.warn(`scheduled refresh: ${e.message}`));
  }, intervalMs);
  if (timer.unref) timer.unref();
  log.info(`scheduler every ${Math.round(intervalMs / 3600000)}h (${liveEnabled() ? 'LIVE' : 'MOCK'} mode)`);
}
