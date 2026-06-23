import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

/**
 * Zero-dependency JSON-file document store. Keeps the project installable
 * anywhere (no native modules) and good enough for a single-node deployment.
 * Swap this file for Postgres/Mongo behind the same method signatures when you
 * scale out — nothing else in the codebase touches storage directly.
 *
 * Collections (think tables):
 *   organizations, users, teams, teamMembers, channelAccounts,
 *   routingRules, conversations, messages, assignments, notifications
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'store.json');

const EMPTY = () => ({
  organizations: {},
  users: {},
  teams: {},
  teamMembers: {},
  channelAccounts: {},
  routingRules: {},
  conversations: {},
  messages: {},
  assignments: {},
  notifications: {},
  cannedResponses: {},
  autoReplies: {},
  projects: {},
  reminders: {},
  // round-robin cursor per "teamId" so assignment rotates fairly
  rrCursors: {},
});

function load() {
  try {
    return { ...EMPTY(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return EMPTY();
  }
}

let state = load();
let writeTimer = null;

/** Debounced async persist so we don't thrash the disk on bursty traffic. */
function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), () => {});
  }, 50);
}

/** Generic collection helpers. */
function collection(name) {
  return {
    all: () => Object.values(state[name]),
    get: (id) => state[name][id] || null,
    find: (pred) => Object.values(state[name]).find(pred) || null,
    filter: (pred) => Object.values(state[name]).filter(pred),
    insert: (doc) => {
      const id = doc.id || nanoid(12);
      const now = new Date().toISOString();
      const row = { id, createdAt: now, updatedAt: now, ...doc };
      state[name][id] = row;
      persist();
      return row;
    },
    update: (id, patch) => {
      const cur = state[name][id];
      if (!cur) return null;
      const row = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      state[name][id] = row;
      persist();
      return row;
    },
    remove: (id) => {
      delete state[name][id];
      persist();
    },
  };
}

export const db = {
  organizations: collection('organizations'),
  users: collection('users'),
  teams: collection('teams'),
  teamMembers: collection('teamMembers'),
  channelAccounts: collection('channelAccounts'),
  routingRules: collection('routingRules'),
  conversations: collection('conversations'),
  messages: collection('messages'),
  assignments: collection('assignments'),
  notifications: collection('notifications'),
  cannedResponses: collection('cannedResponses'),
  autoReplies: collection('autoReplies'),
  projects: collection('projects'),
  reminders: collection('reminders'),

  /** Round-robin cursor accessors (kept outside generic CRUD on purpose). */
  getCursor(key) {
    return state.rrCursors[key] ?? -1;
  },
  setCursor(key, value) {
    state.rrCursors[key] = value;
    persist();
  },

  /** True when the store has never been seeded. */
  isEmpty() {
    return Object.keys(state.organizations).length === 0;
  },

  /** Test helper — wipe everything. */
  _reset() {
    state = EMPTY();
    persist();
  },
};
