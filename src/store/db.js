import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { pgStore } from './pg.js';
import { logger } from '../logger.js';

const log = logger('db');

/**
 * Document store with a fast synchronous in-memory state. Persistence is
 * pluggable: a debounced JSON file by default, or write-through to Postgres
 * when DATABASE_URL is set (call db.init() at boot). Business logic never
 * touches storage directly — only these method signatures.
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
  pushSubscriptions: {},
  gameCampaigns: {},
  gameDraws: {},
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
let mode = 'file'; // 'file' | 'pg'
let writeTimer = null;

/** Debounced JSON-file write so we don't thrash the disk on bursty traffic. */
function persistFile() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), () => {});
  }, 50);
}

/** Persist a single changed row (data === null → delete). */
function persistRow(name, id, data) {
  if (mode === 'pg') {
    if (data === null) pgStore.del(name, id); else pgStore.upsert(name, id, data);
  } else {
    persistFile();
  }
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
      persistRow(name, id, row);
      return row;
    },
    update: (id, patch) => {
      const cur = state[name][id];
      if (!cur) return null;
      const row = { ...cur, ...patch, updatedAt: new Date().toISOString() };
      state[name][id] = row;
      persistRow(name, id, row);
      return row;
    },
    remove: (id) => {
      delete state[name][id];
      persistRow(name, id, null);
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
  pushSubscriptions: collection('pushSubscriptions'),
  gameCampaigns: collection('gameCampaigns'),
  gameDraws: collection('gameDraws'),

  /**
   * Load persisted data. When DATABASE_URL is set, hydrate from Postgres and
   * switch to write-through mode; otherwise keep the file-backed state.
   */
  async init() {
    if (!pgStore.enabled) { mode = 'file'; return; }
    try {
      const rows = await pgStore.init();
      state = EMPTY();
      for (const r of rows) {
        if (r.collection === '_cursors') state.rrCursors[r.id] = r.data?.value;
        else if (state[r.collection]) state[r.collection][r.id] = r.data;
      }
      mode = 'pg';
      log.info('using Postgres persistence');
    } catch (e) {
      log.error(`Postgres init failed — falling back to file: ${e.message}`);
      mode = 'file';
    }
  },

  /** Round-robin cursor accessors (kept outside generic CRUD on purpose). */
  getCursor(key) {
    return state.rrCursors[key] ?? -1;
  },
  setCursor(key, value) {
    state.rrCursors[key] = value;
    persistRow('_cursors', key, { value });
  },

  /** True when the store has never been seeded. */
  isEmpty() {
    return Object.keys(state.organizations).length === 0;
  },

  /** Test helper — wipe everything. */
  _reset() {
    state = EMPTY();
    if (mode === 'pg') pgStore.truncate().catch(() => {}); else persistFile();
  },
};

