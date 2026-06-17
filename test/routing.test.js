import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/store/db.js';
import { seedIfEmpty } from '../src/store/seed.js';
import { ingestInbound } from '../src/core/conversations.js';
import { can, PERMISSIONS, isEligibleForAssignment } from '../src/core/rbac.js';

db._reset();
seedIfEmpty();

const mockAccount = db.channelAccounts.find((c) => c.channelType === 'mock');

function inbound(participantId, text, extra = {}) {
  return ingestInbound(mockAccount, {
    participantId, participantName: 'Tester', text,
    externalMessageId: 'x' + Math.random(), timestamp: new Date().toISOString(), ...extra,
  });
}

test('round robin rotates across online eligible agents', () => {
  const owners = [];
  for (let i = 1; i <= 4; i++) {
    const { conversation } = inbound('cust_' + i, 'hello');
    owners.push(db.conversations.get(conversation.id).assignedUserId);
  }
  // team_a eligible online agents: u_sales1, u_sales2, u_sales3 → wrap on 4th
  assert.deepEqual(owners, ['u_sales1', 'u_sales2', 'u_sales3', 'u_sales1']);
});

test('VIP conversations route to the Senior Sales team', () => {
  const { conversation } = inbound('vip_1', 'need help', { vip: true });
  assert.equal(db.conversations.get(conversation.id).assignedUserId, 'u_senior1');
});

test('complaint keyword routes to a supervisor', () => {
  const { conversation } = inbound('angry_1', 'I want a refund now');
  assert.equal(db.conversations.get(conversation.id).assignedUserId, 'u_supervisor');
});

test('offline agents are skipped by round robin', () => {
  db.users.update('u_sales1', { presence: 'offline' });
  db.users.update('u_sales2', { presence: 'offline' });
  const { conversation } = inbound('skip_1', 'hi');
  assert.equal(db.conversations.get(conversation.id).assignedUserId, 'u_sales3');
});

test('RBAC: viewer cannot reply, agent can', () => {
  assert.equal(can(db.users.get('u_viewer'), PERMISSIONS.REPLY), false);
  assert.equal(can(db.users.get('u_sales1'), PERMISSIONS.REPLY), true);
});

test('RBAC: only agents are eligible for round-robin ownership', () => {
  assert.equal(isEligibleForAssignment(db.users.get('u_sales1')), true);
  assert.equal(isEligibleForAssignment(db.users.get('u_manager')), false);
  assert.equal(isEligibleForAssignment(db.users.get('u_supervisor')), false);
});

test('inbound creates a message and increments unread', () => {
  const { conversation } = inbound('msgcount_1', 'first');
  const updated = db.conversations.get(conversation.id);
  assert.equal(updated.unread, 1);
  assert.equal(db.messages.filter((m) => m.conversationId === conversation.id).length, 1);
});

test('manual-routing channels leave conversations unassigned', () => {
  const fbSupport = db.channelAccounts.get('ca_fb_support');
  const { conversation } = ingestInbound(fbSupport, {
    participantId: 'manual_1', participantName: 'X', text: 'hello',
    externalMessageId: 'm1', timestamp: new Date().toISOString(),
  });
  assert.equal(db.conversations.get(conversation.id).assignedUserId, null);
});
