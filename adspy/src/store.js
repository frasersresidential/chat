import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Zero-dependency JSON document store — a trimmed-down clone of OmniChat's
 * (../../src/store/db.js): synchronous in-memory state with a debounced file
 * write. Collections: competitors, ads, pushSubscriptions.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'store.json');

const EMPTY = () => ({
  competitors: {},
  ads: {},
  pushSubscriptions: {},
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

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), () => {});
  }, 50);
}

function collection(name) {
  return {
    all: () => Object.values(state[name]),
    get: (id) => state[name][id] || null,
    find: (pred) => Object.values(state[name]).find(pred) || null,
    filter: (pred) => Object.values(state[name]).filter(pred),
    insert: (doc) => {
      const id = doc.id || crypto.randomUUID().slice(0, 12);
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
  competitors: collection('competitors'),
  ads: collection('ads'),
  pushSubscriptions: collection('pushSubscriptions'),

  isEmpty() {
    return Object.keys(state.competitors).length === 0;
  },

  /** Test helper — wipe everything. */
  _reset() {
    state = EMPTY();
    persist();
  },
};
