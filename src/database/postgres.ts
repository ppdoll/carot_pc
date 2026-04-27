import { Pool, PoolClient } from 'pg';
import { databaseUrl } from './env';

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

export function hasPostgresConfig(): boolean {
  return Boolean(databaseUrl());
}

export function getPostgresPool(): Pool {
  const url = databaseUrl();
  if (!url) {
    throw new Error('DATABASE_URL 또는 POSTGRES_URL이 설정되어 있지 않습니다.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: Number(process.env.POSTGRES_POOL_MAX ?? 3),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: /sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

export async function ensurePostgresSchema(): Promise<void> {
  if (!hasPostgresConfig()) {
    return;
  }

  if (!schemaPromise) {
    schemaPromise = createSchema();
  }

  return schemaPromise;
}

export async function withTransaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await task(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createSchema(): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_snapshots (
      id TEXT PRIMARY KEY,
      listing_key TEXT NOT NULL,
      component_signature TEXT NOT NULL,
      source_url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      title TEXT NOT NULL,
      listing_price INTEGER,
      cpu_key TEXT,
      ram_key TEXT,
      gpu_key TEXT,
      captured_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL,
      UNIQUE (listing_key, component_signature)
    );

    CREATE INDEX IF NOT EXISTS quote_snapshots_last_seen_idx
      ON quote_snapshots (last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS quote_snapshots_cpu_idx
      ON quote_snapshots (LOWER(cpu_key));
    CREATE INDEX IF NOT EXISTS quote_snapshots_ram_idx
      ON quote_snapshots (LOWER(ram_key));
    CREATE INDEX IF NOT EXISTS quote_snapshots_gpu_idx
      ON quote_snapshots (LOWER(gpu_key));

    CREATE TABLE IF NOT EXISTS quote_snapshot_components (
      snapshot_id TEXT NOT NULL REFERENCES quote_snapshots(id) ON DELETE CASCADE,
      component_order INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      raw_value TEXT,
      search_query TEXT,
      compuzone_price INTEGER,
      compuzone_name TEXT,
      bunjang JSONB,
      joongna JSONB,
      PRIMARY KEY (snapshot_id, component_order)
    );

    CREATE TABLE IF NOT EXISTS quote_price_history (
      snapshot_id TEXT NOT NULL REFERENCES quote_snapshots(id) ON DELETE CASCADE,
      captured_at TIMESTAMPTZ NOT NULL,
      listing_price INTEGER,
      PRIMARY KEY (snapshot_id, captured_at)
    );

    CREATE TABLE IF NOT EXISTS price_votes (
      target_id TEXT NOT NULL,
      voter_hash TEXT NOT NULL,
      vote TEXT NOT NULL CHECK (vote IN ('great', 'fair', 'expensive')),
      voted_at TIMESTAMPTZ NOT NULL,
      source_url TEXT,
      final_url TEXT,
      title TEXT,
      PRIMARY KEY (target_id, voter_hash)
    );

    CREATE INDEX IF NOT EXISTS price_votes_target_idx
      ON price_votes (target_id);
  `);
}
