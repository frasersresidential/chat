import { logger } from '../logger.js';

const log = logger('pg');

/**
 * Optional Postgres persistence. Activated only when DATABASE_URL is set.
 * The whole app keeps its fast synchronous in-memory store; this layer
 * write-throughs every change to a single JSONB `documents` table and reloads
 * it on boot. Swap to per-table schemas later if you outgrow it.
 */
let pool = null;

export const pgStore = {
  get enabled() {
    return !!process.env.DATABASE_URL;
  },

  /** Connect, ensure the table exists, and return all stored rows. */
  async init() {
    const pg = await import('pg');
    const Pool = pg.Pool || pg.default?.Pool;
    const url = process.env.DATABASE_URL;
    const ssl = /@(localhost|127\.0\.0\.1)/.test(url) ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString: url, ssl, max: 5, connectionTimeoutMillis: 8000 });
    await pool.query(`CREATE TABLE IF NOT EXISTS documents (
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (collection, id)
    )`);
    const { rows } = await pool.query('SELECT collection, id, data FROM documents');
    log.info(`connected; ${rows.length} documents loaded`);
    return rows;
  },

  upsert(collection, id, data) {
    if (!pool) return;
    pool.query(
      `INSERT INTO documents (collection, id, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (collection, id) DO UPDATE SET data = $3, updated_at = now()`,
      [collection, id, data],
    ).catch((e) => log.error(`upsert ${collection}/${id}: ${e.message}`));
  },

  del(collection, id) {
    if (!pool) return;
    pool.query('DELETE FROM documents WHERE collection = $1 AND id = $2', [collection, id])
      .catch((e) => log.error(`delete ${collection}/${id}: ${e.message}`));
  },

  async truncate() {
    if (pool) await pool.query('TRUNCATE documents');
  },
};
