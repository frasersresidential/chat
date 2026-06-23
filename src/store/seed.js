import { db } from './db.js';
import { PRESENCE } from '../core/presence.js';
import { hashPassword } from '../core/auth.js';
import { defaultBusinessHours } from '../core/businessHours.js';
import { defaultDailyReport } from '../core/dailyReport.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const log = logger('seed');

/**
 * Demo dataset modelling the requirements: one organization ("Company A") with
 * multiple connected accounts per channel, a team hierarchy, every RBAC role,
 * and routing rules covering round-robin, skill-based, VIP and keyword cases.
 *
 * Runs only on an empty store, so restarting never clobbers real data.
 */
export function seedIfEmpty() {
  if (!db.isEmpty()) return;
  log.info('seeding demo organization "Company A"...');

  const org = db.organizations.insert({ id: 'org_company_a', name: 'Company A', businessHours: defaultBusinessHours(), dailyReport: defaultDailyReport() });
  const O = org.id;

  // ── Teams (hierarchy) ─────────────────────────────────────────────────────
  const salesDept = db.teams.insert({ id: 'team_sales_dept', organizationId: O, name: 'Sales Department', parentId: null });
  const teamA = db.teams.insert({ id: 'team_a', organizationId: O, name: 'Team A', parentId: salesDept.id });
  const teamB = db.teams.insert({ id: 'team_b', organizationId: O, name: 'Team B', parentId: salesDept.id });
  const seniorTeam = db.teams.insert({ id: 'team_senior', organizationId: O, name: 'Senior Sales', parentId: salesDept.id });
  const luxuryTeam = db.teams.insert({ id: 'team_luxury', organizationId: O, name: 'Luxury Sales Team', parentId: salesDept.id });
  const supportTeam = db.teams.insert({ id: 'team_support', organizationId: O, name: 'Support Team', parentId: null });
  const marketingTeam = db.teams.insert({ id: 'team_marketing', organizationId: O, name: 'Marketing Team', parentId: null });
  // Project sales teams — chats from Meta ads whose Ad set name contains the
  // project code are routed here (see the 'adset' routing rules below).
  const projRym = db.teams.insert({ id: 'team_proj_rym', organizationId: O, name: 'Sales โครงการ Rhythm (RYM)', parentId: salesDept.id, skills: ['rym'] });
  const projLpn = db.teams.insert({ id: 'team_proj_lpn', organizationId: O, name: 'Sales โครงการ Lumpini (LPN)', parentId: salesDept.id, skills: ['lpn'] });

  // ── Users (every role) ────────────────────────────────────────────────────
  const demoHash = hashPassword(config.demoPassword);
  const mkUser = (id, name, role, presence = PRESENCE.OFFLINE) =>
    db.users.insert({ id, organizationId: O, name, email: `${id}@company-a.com`, role, presence, status: 'active', passwordHash: demoHash });

  const owner = mkUser('u_owner', 'Olivia Owner', 'owner');
  const admin = mkUser('u_admin', 'Adam Admin', 'admin');
  const manager = mkUser('u_manager', 'Mia Manager', 'manager', PRESENCE.ONLINE);
  const supervisor = mkUser('u_supervisor', 'Sam Supervisor', 'supervisor', PRESENCE.ONLINE);
  const sales1 = mkUser('u_sales1', 'Sales 1', 'agent', PRESENCE.ONLINE);
  const sales2 = mkUser('u_sales2', 'Sales 2', 'agent', PRESENCE.ONLINE);
  const sales3 = mkUser('u_sales3', 'Sales 3', 'agent', PRESENCE.ONLINE);
  const senior1 = mkUser('u_senior1', 'Senior Sales', 'agent', PRESENCE.ONLINE);
  const support1 = mkUser('u_support1', 'Support 1', 'agent', PRESENCE.ONLINE);
  const support2 = mkUser('u_support2', 'Support 2', 'agent', PRESENCE.ONLINE);
  const mkt1 = mkUser('u_mkt1', 'Marketing 1', 'agent', PRESENCE.ONLINE);
  const luxury1 = mkUser('u_luxury1', 'Luxury Sales', 'agent', PRESENCE.ONLINE);
  const viewer = mkUser('u_viewer', 'Vic Viewer', 'viewer');

  // ── Team memberships ──────────────────────────────────────────────────────
  const member = (team, user, role) =>
    db.teamMembers.insert({ teamId: team.id, userId: user.id, role });

  member(salesDept, manager, 'manager');
  member(teamA, supervisor, 'supervisor');
  member(teamA, sales1, 'agent');
  member(teamA, sales2, 'agent');
  member(teamA, sales3, 'agent');
  member(teamB, sales2, 'agent');
  member(seniorTeam, senior1, 'agent');
  member(luxuryTeam, luxury1, 'agent');
  member(supportTeam, support1, 'agent');
  member(supportTeam, support2, 'agent');
  member(marketingTeam, mkt1, 'agent');
  // Project sales reps (an agent can belong to several teams)
  member(projRym, sales1, 'agent');
  member(projRym, senior1, 'agent');
  member(projLpn, sales3, 'agent');

  // ── Channel accounts (multiple per channel) ───────────────────────────────
  // credential is intentionally empty → adapters run in "simulated" mode so the
  // whole platform works with zero real API keys. Fill these via the admin UI
  // (or .env) to go live.
  const ch = (id, channelType, accountName, accountId) =>
    db.channelAccounts.insert({
      id,
      organizationId: O,
      channelType,
      accountName,
      accountId,
      credential: {},
      webhookStatus: 'pending',
      status: 'active',
    });

  const lineA = ch('ca_line_a', 'line', 'LINE OA Brand A', 'line_brand_a');
  const lineB = ch('ca_line_b', 'line', 'LINE OA Brand B', 'line_brand_b');
  ch('ca_line_after', 'line', 'LINE OA After Sales', 'line_after_sales');
  const fbA = ch('ca_fb_a', 'messenger', 'Facebook Page Product A', 'fb_page_a');
  ch('ca_fb_b', 'messenger', 'Facebook Page Product B', 'fb_page_b');
  const fbSupport = ch('ca_fb_support', 'messenger', 'Facebook Page Support', 'fb_page_support');
  const ig = ch('ca_ig', 'instagram', 'Instagram Marketing', 'ig_main');
  ch('ca_wa', 'whatsapp', 'WhatsApp Business', 'wa_main');
  // A mock account so you can drive the demo via POST /webhooks/mock.
  ch('ca_mock', 'mock', 'Sandbox (Mock)', 'mock_main');

  // ── Routing rules ─────────────────────────────────────────────────────────
  const rule = (channelAccount, teamId, routingType, priority, condition, assignToRole = null) =>
    db.routingRules.insert({
      channelAccountId: channelAccount.id,
      teamId,
      routingType,
      priority,
      condition,
      assignToRole,
    });

  // LINE OA Brand A: keyword→supervisor (P5), VIP→senior (P10), default round robin (P100)
  rule(lineA, teamA.id, 'round_robin', 5,
    { type: 'keyword', keywords: ['complaint', 'ร้องเรียน', 'แย่มาก', 'ช้ามาก', 'refund', 'คืนเงิน'] },
    'supervisor');
  rule(lineA, seniorTeam.id, 'round_robin', 10, { type: 'vip' });
  rule(lineA, teamA.id, 'round_robin', 100, { type: 'always' });

  // LINE OA Brand B → Team B round robin
  rule(lineB, teamB.id, 'round_robin', 100, { type: 'always' });
  // LINE After Sales → Support round robin
  rule(db.channelAccounts.get('ca_line_after'), supportTeam.id, 'round_robin', 100, { type: 'always' });

  // Facebook pages (project routing is handled by the Projects below)
  rule(fbA, teamA.id, 'round_robin', 100, { type: 'always' }); // fallback when no project matches
  rule(db.channelAccounts.get('ca_fb_b'), teamB.id, 'round_robin', 100, { type: 'always' });
  rule(fbSupport, supportTeam.id, 'manual', 100, { type: 'always' }); // manual assignment

  // Instagram → Marketing (skill based)
  rule(ig, marketingTeam.id, 'round_robin', 100, { type: 'always' });
  // WhatsApp → Support
  rule(db.channelAccounts.get('ca_wa'), supportTeam.id, 'round_robin', 100, { type: 'always' });
  // Mock sandbox → Team A round robin (+ inherits VIP/keyword demo by adding rules)
  rule(db.channelAccounts.get('ca_mock'), teamA.id, 'round_robin', 5,
    { type: 'keyword', keywords: ['complaint', 'ร้องเรียน', 'refund', 'คืนเงิน'] }, 'supervisor');
  rule(db.channelAccounts.get('ca_mock'), seniorTeam.id, 'round_robin', 10, { type: 'vip' });
  rule(db.channelAccounts.get('ca_mock'), teamA.id, 'round_robin', 100, { type: 'always' });

  // ── Canned / quick replies (shared across the org) ───────────────────────
  const canned = (title, text, shortcut) =>
    db.cannedResponses.insert({ organizationId: org.id, title, text, shortcut, createdBy: 'system' });
  canned('ทักทาย', 'สวัสดีค่ะ ยินดีให้บริการค่ะ 😊 มีอะไรให้ช่วยดูแลไหมคะ', '/hi');
  canned('ขอบคุณ', 'ขอบคุณมากค่ะ 🙏 หากมีคำถามเพิ่มเติมสอบถามได้เลยนะคะ', '/thx');
  canned('รอสักครู่', 'รบกวนรอสักครู่นะคะ กำลังตรวจสอบข้อมูลให้ค่ะ', '/wait');
  canned('ขอข้อมูลติดต่อ', 'รบกวนขอชื่อ-เบอร์โทร และที่อยู่สำหรับจัดส่งด้วยนะคะ', '/info');
  canned('ชำระเงิน', 'ชำระผ่านบัญชีธนาคารหรือพร้อมเพย์ได้เลยค่ะ แจ้งสลิปหลังโอนได้เลยนะคะ', '/pay');

  // ── Projects (Ad-set code → project name + sales team) ───────────────────
  const project = (id, name, keywords, teamId) =>
    db.projects.insert({ id, organizationId: O, name, code: keywords[0], keywords, teamId });
  project('proj_rym', 'Rhythm (RYM)', ['RYM', 'Rhythm', 'ริทึ่ม'], projRym.id);
  project('proj_lpn', 'Lumpini (LPN)', ['LPN', 'Lumpini', 'ลุมพินี'], projLpn.id);

  // ── Auto-replies / chatbot ───────────────────────────────────────────────
  const auto = (type, text, keywords = []) =>
    db.autoReplies.insert({ organizationId: org.id, type, text, keywords, channelAccountId: null, enabled: true });
  auto('welcome', 'สวัสดีค่ะ ขอบคุณที่ติดต่อเข้ามานะคะ 🙏 ทีมงานกำลังรีบมาดูแลค่ะ');
  auto('away', 'ขณะนี้อยู่นอกเวลาทำการค่ะ ทีมงานจะรีบติดต่อกลับโดยเร็วที่สุดนะคะ 😊');
  auto('keyword', 'ราคาเริ่มต้นที่ 2.5 ล้านบาทค่ะ สนใจห้องแบบไหนดีคะ เดี๋ยวทีมขายส่งรายละเอียดให้นะคะ', ['ราคา', 'เท่าไหร่', 'price']);

  log.info('seed complete: 1 org, ' + db.users.all().length + ' users, ' +
    db.channelAccounts.all().length + ' channel accounts, ' +
    db.routingRules.all().length + ' routing rules, ' +
    db.cannedResponses.all().length + ' canned replies, ' +
    db.autoReplies.all().length + ' auto-replies');
}
