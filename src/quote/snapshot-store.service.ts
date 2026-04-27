import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PoolClient } from 'pg';
import { ensurePostgresSchema, getPostgresPool, hasPostgresConfig, withTransaction } from '../database/postgres';
import { ComponentKeys } from './component-key';
import { ComponentPriceEstimate, PcQuoteAnalysis } from './types';
import { UsedMarketSummary } from './used-market';

export interface SnapshotComponent {
  type: string;
  label: string;
  rawValue: string | null;
  searchQuery: string | null;
  compuzonePrice: number | null;
  compuzoneName: string | null;
  bunjang: UsedMarketSummary | null;
  joongna: UsedMarketSummary | null;
}

export interface SnapshotPriceHistoryEntry {
  capturedAt: string;
  listingPrice: number | null;
}

export interface QuoteSnapshot {
  id: string;
  capturedAt: string;
  lastSeenAt?: string;
  sourceUrl: string;
  finalUrl: string;
  title: string;
  listingPrice: number | null;
  keys: ComponentKeys;
  components: SnapshotComponent[];
  priceHistory?: SnapshotPriceHistoryEntry[];
}

export interface SnapshotFilter {
  cpu?: string | null;
  ram?: string | null;
  gpu?: string | null;
}

const DEFAULT_MAX_SNAPSHOTS = 50;

export interface SnapshotStoreOptions {
  filePath?: string;
  maxSnapshots?: number;
}

@Injectable()
export class SnapshotStoreService {
  private maxSnapshots: number = DEFAULT_MAX_SNAPSHOTS;
  private filePath: string = join(process.cwd(), 'data', 'snapshots.json');
  private cache: QuoteSnapshot[] | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private forceJsonStore = false;

  configure(options: SnapshotStoreOptions = {}): this {
    if (options.filePath) {
      this.filePath = options.filePath;
      this.forceJsonStore = true;
    }
    if (options.maxSnapshots !== undefined) {
      this.maxSnapshots = options.maxSnapshots;
    }
    this.cache = null;
    return this;
  }

  async list(filter: SnapshotFilter = {}): Promise<QuoteSnapshot[]> {
    if (this.shouldUsePostgres()) {
      return this.listFromPostgres(filter);
    }

    const all = await this.load();
    const cpu = normalizeFilter(filter.cpu);
    const ram = normalizeFilter(filter.ram);
    const gpu = normalizeFilter(filter.gpu);

    return all
      .filter((snapshot) => (cpu ? matches(snapshot.keys.cpuKey, cpu) : true))
      .filter((snapshot) => (ram ? matches(snapshot.keys.ramKey, ram) : true))
      .filter((snapshot) => (gpu ? matches(snapshot.keys.gpuKey, gpu) : true))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  async distinctKeys(): Promise<{ cpu: string[]; ram: string[]; gpu: string[] }> {
    if (this.shouldUsePostgres()) {
      return this.distinctKeysFromPostgres();
    }

    const all = await this.load();
    return {
      cpu: distinctValues(all.map((snapshot) => snapshot.keys.cpuKey)),
      ram: distinctValues(all.map((snapshot) => snapshot.keys.ramKey)),
      gpu: distinctValues(all.map((snapshot) => snapshot.keys.gpuKey)),
    };
  }

  async save(snapshot: QuoteSnapshot): Promise<void> {
    if (this.shouldUsePostgres()) {
      await this.saveToPostgres(snapshot);
      return;
    }

    await this.enqueueWrite(async () => {
      const existing = await this.load();
      const same: QuoteSnapshot[] = [];
      const others: QuoteSnapshot[] = [];
      for (const current of existing) {
        if (sameSnapshotIdentity(current, snapshot)) {
          same.push(current);
        } else {
          others.push(current);
        }
      }

      const merged = mergeSnapshots([...same, snapshot]);
      const next = [merged, ...others]
        .sort((a, b) => snapshotSortDate(b).localeCompare(snapshotSortDate(a)))
        .slice(0, this.maxSnapshots);
      this.cache = next;
      await this.persist(next);
    });
  }

  static fromAnalysis(analysis: PcQuoteAnalysis, keys: ComponentKeys): QuoteSnapshot {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: analysis.analyzedAt,
      sourceUrl: analysis.listing.sourceUrl,
      finalUrl: analysis.listing.finalUrl,
      title: analysis.listing.title,
      listingPrice: analysis.listing.price,
      keys,
      components: analysis.components.map((estimate) => toSnapshotComponent(estimate)),
    };
  }

  private async load(): Promise<QuoteSnapshot[]> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? (parsed as QuoteSnapshot[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
      } else {
        throw error;
      }
    }

    return this.cache!;
  }

  private async persist(snapshots: QuoteSnapshot[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshots, null, 2), 'utf-8');
    await rename(tmp, this.filePath);
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private shouldUsePostgres(): boolean {
    return !this.forceJsonStore && hasPostgresConfig();
  }

  private async listFromPostgres(filter: SnapshotFilter = {}): Promise<QuoteSnapshot[]> {
    await ensurePostgresSchema();
    const pool = getPostgresPool();
    const values: unknown[] = [];
    const where: string[] = [];
    const cpu = normalizeFilter(filter.cpu);
    const ram = normalizeFilter(filter.ram);
    const gpu = normalizeFilter(filter.gpu);

    if (cpu) {
      values.push(`%${cpu}%`);
      where.push(`LOWER(cpu_key) LIKE $${values.length}`);
    }
    if (ram) {
      values.push(`%${ram}%`);
      where.push(`LOWER(ram_key) LIKE $${values.length}`);
    }
    if (gpu) {
      values.push(`%${gpu}%`);
      where.push(`LOWER(gpu_key) LIKE $${values.length}`);
    }

    const snapshots = await pool.query<PostgresSnapshotRow>(
      `
        SELECT *
        FROM quote_snapshots
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY last_seen_at DESC
        LIMIT ${this.maxSnapshots}
      `,
      values,
    );

    if (snapshots.rows.length === 0) {
      return [];
    }

    const ids = snapshots.rows.map((row) => row.id);
    const [components, history] = await Promise.all([
      pool.query<PostgresComponentRow>(
        `
          SELECT *
          FROM quote_snapshot_components
          WHERE snapshot_id = ANY($1::text[])
          ORDER BY snapshot_id, component_order
        `,
        [ids],
      ),
      pool.query<PostgresHistoryRow>(
        `
          SELECT *
          FROM quote_price_history
          WHERE snapshot_id = ANY($1::text[])
          ORDER BY snapshot_id, captured_at
        `,
        [ids],
      ),
    ]);

    const componentsBySnapshot = groupBy(components.rows, (row) => row.snapshot_id);
    const historyBySnapshot = groupBy(history.rows, (row) => row.snapshot_id);

    return snapshots.rows.map((row) =>
      snapshotFromPostgres(
        row,
        componentsBySnapshot.get(row.id) ?? [],
        historyBySnapshot.get(row.id) ?? [],
      ),
    );
  }

  private async distinctKeysFromPostgres(): Promise<{ cpu: string[]; ram: string[]; gpu: string[] }> {
    await ensurePostgresSchema();
    const pool = getPostgresPool();
    const [cpu, ram, gpu] = await Promise.all([
      pool.query<{ value: string }>('SELECT DISTINCT cpu_key AS value FROM quote_snapshots WHERE cpu_key IS NOT NULL ORDER BY cpu_key'),
      pool.query<{ value: string }>('SELECT DISTINCT ram_key AS value FROM quote_snapshots WHERE ram_key IS NOT NULL ORDER BY ram_key'),
      pool.query<{ value: string }>('SELECT DISTINCT gpu_key AS value FROM quote_snapshots WHERE gpu_key IS NOT NULL ORDER BY gpu_key'),
    ]);

    return {
      cpu: cpu.rows.map((row) => row.value),
      ram: ram.rows.map((row) => row.value),
      gpu: gpu.rows.map((row) => row.value),
    };
  }

  private async saveToPostgres(snapshot: QuoteSnapshot): Promise<void> {
    await ensurePostgresSchema();
    await withTransaction(async (client) => {
      const listingKey = normalizeUrlKey(snapshot.finalUrl || snapshot.sourceUrl);
      const signature = componentSignature(snapshot.components);
      const existing = await client.query<{ id: string }>(
        `
          SELECT id
          FROM quote_snapshots
          WHERE listing_key = $1 AND component_signature = $2
          FOR UPDATE
        `,
        [listingKey, signature],
      );
      const existingId = existing.rows[0]?.id;
      const snapshotId = existingId ?? snapshot.id;

      if (existingId) {
        await updatePostgresSnapshot(client, snapshotId, snapshot, listingKey, signature);
      } else {
        await insertPostgresSnapshot(client, snapshotId, snapshot, listingKey, signature);
      }

      await replacePostgresComponents(client, snapshotId, snapshot.components);
      await appendPostgresPriceHistory(client, snapshotId, snapshot);
      await trimPostgresSnapshots(client, this.maxSnapshots);
    });
  }
}

interface PostgresSnapshotRow {
  id: string;
  source_url: string;
  final_url: string;
  title: string;
  listing_price: number | null;
  cpu_key: string | null;
  ram_key: string | null;
  gpu_key: string | null;
  captured_at: Date;
  last_seen_at: Date;
}

interface PostgresComponentRow {
  snapshot_id: string;
  component_order: number;
  type: string;
  label: string;
  raw_value: string | null;
  search_query: string | null;
  compuzone_price: number | null;
  compuzone_name: string | null;
  bunjang: UsedMarketSummary | null;
  joongna: UsedMarketSummary | null;
}

interface PostgresHistoryRow {
  snapshot_id: string;
  captured_at: Date;
  listing_price: number | null;
}

function toSnapshotComponent(estimate: ComponentPriceEstimate): SnapshotComponent {
  return {
    type: estimate.component.type,
    label: estimate.component.label,
    rawValue: estimate.component.rawValue,
    searchQuery: estimate.component.searchQuery,
    compuzonePrice: estimate.selectedProduct?.price ?? null,
    compuzoneName: estimate.selectedProduct?.name ?? null,
    bunjang: estimate.usedMarket?.bunjang ?? null,
    joongna: estimate.usedMarket?.joongna ?? null,
  };
}

function normalizeFilter(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

function matches(key: string | null, query: string): boolean {
  if (!key) {
    return false;
  }
  return key.toLowerCase().includes(query);
}

function distinctValues(values: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (value) {
      set.add(value);
    }
  }
  return [...set].sort();
}

function sameSnapshotIdentity(a: QuoteSnapshot, b: QuoteSnapshot): boolean {
  return normalizeUrlKey(a.finalUrl || a.sourceUrl) === normalizeUrlKey(b.finalUrl || b.sourceUrl)
    && componentSignature(a.components) === componentSignature(b.components);
}

function mergeSnapshots(snapshots: QuoteSnapshot[]): QuoteSnapshot {
  const sorted = [...snapshots].sort((a, b) => snapshotSortDate(a).localeCompare(snapshotSortDate(b)));
  const latest = sorted.at(-1)!;
  const first = sorted[0]!;
  const history = buildPriceHistory(sorted);

  return {
    ...latest,
    id: first.id,
    capturedAt: latest.capturedAt,
    lastSeenAt: snapshotSortDate(latest),
    priceHistory: history,
  };
}

function buildPriceHistory(snapshots: QuoteSnapshot[]): SnapshotPriceHistoryEntry[] {
  const entries = snapshots
    .flatMap((snapshot) => snapshotPriceEntries(snapshot))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const history: SnapshotPriceHistoryEntry[] = [];

  for (const entry of entries) {
    const last = history.at(-1);
    if (!last || last.listingPrice !== entry.listingPrice) {
      history.push(entry);
    }
  }

  return history;
}

function snapshotPriceEntries(snapshot: QuoteSnapshot): SnapshotPriceHistoryEntry[] {
  const entries = snapshot.priceHistory?.length
    ? snapshot.priceHistory
    : [{ capturedAt: snapshot.capturedAt, listingPrice: snapshot.listingPrice }];
  const hasCurrentEntry = entries.some(
    (entry) => entry.capturedAt === snapshot.capturedAt && entry.listingPrice === snapshot.listingPrice,
  );

  return hasCurrentEntry
    ? entries
    : [...entries, { capturedAt: snapshot.capturedAt, listingPrice: snapshot.listingPrice }];
}

function snapshotSortDate(snapshot: QuoteSnapshot): string {
  return snapshot.lastSeenAt || snapshot.capturedAt;
}

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim().replace(/\/$/, '').toLowerCase();
  }
}

function componentSignature(components: SnapshotComponent[]): string {
  return components
    .map((component) =>
      [
        component.type,
        normalizeText(component.rawValue),
        normalizeText(component.searchQuery),
      ].join(':'),
    )
    .sort()
    .join('|');
}

function normalizeText(value: string | null): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function insertPostgresSnapshot(
  client: PoolClient,
  snapshotId: string,
  snapshot: QuoteSnapshot,
  listingKey: string,
  signature: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO quote_snapshots (
        id, listing_key, component_signature, source_url, final_url, title,
        listing_price, cpu_key, ram_key, gpu_key, captured_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
    `,
    [
      snapshotId,
      listingKey,
      signature,
      snapshot.sourceUrl,
      snapshot.finalUrl,
      snapshot.title,
      snapshot.listingPrice,
      snapshot.keys.cpuKey,
      snapshot.keys.ramKey,
      snapshot.keys.gpuKey,
      snapshot.capturedAt,
    ],
  );
}

async function updatePostgresSnapshot(
  client: PoolClient,
  snapshotId: string,
  snapshot: QuoteSnapshot,
  listingKey: string,
  signature: string,
): Promise<void> {
  await client.query(
    `
      UPDATE quote_snapshots
      SET
        listing_key = $2,
        component_signature = $3,
        source_url = $4,
        final_url = $5,
        title = $6,
        listing_price = $7,
        cpu_key = $8,
        ram_key = $9,
        gpu_key = $10,
        last_seen_at = $11
      WHERE id = $1
    `,
    [
      snapshotId,
      listingKey,
      signature,
      snapshot.sourceUrl,
      snapshot.finalUrl,
      snapshot.title,
      snapshot.listingPrice,
      snapshot.keys.cpuKey,
      snapshot.keys.ramKey,
      snapshot.keys.gpuKey,
      snapshot.capturedAt,
    ],
  );
}

async function replacePostgresComponents(
  client: PoolClient,
  snapshotId: string,
  components: SnapshotComponent[],
): Promise<void> {
  await client.query('DELETE FROM quote_snapshot_components WHERE snapshot_id = $1', [snapshotId]);

  for (const [index, component] of components.entries()) {
    await client.query(
      `
        INSERT INTO quote_snapshot_components (
          snapshot_id, component_order, type, label, raw_value, search_query,
          compuzone_price, compuzone_name, bunjang, joongna
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
      `,
      [
        snapshotId,
        index,
        component.type,
        component.label,
        component.rawValue,
        component.searchQuery,
        component.compuzonePrice,
        component.compuzoneName,
        jsonParam(component.bunjang),
        jsonParam(component.joongna),
      ],
    );
  }
}

async function appendPostgresPriceHistory(
  client: PoolClient,
  snapshotId: string,
  snapshot: QuoteSnapshot,
): Promise<void> {
  const latest = await client.query<{ listing_price: number | null }>(
    `
      SELECT listing_price
      FROM quote_price_history
      WHERE snapshot_id = $1
      ORDER BY captured_at DESC
      LIMIT 1
    `,
    [snapshotId],
  );
  const latestPrice = latest.rows[0]?.listing_price;

  if (latest.rows.length === 0 || latestPrice !== snapshot.listingPrice) {
    await client.query(
      `
        INSERT INTO quote_price_history (snapshot_id, captured_at, listing_price)
        VALUES ($1, $2, $3)
        ON CONFLICT (snapshot_id, captured_at)
        DO UPDATE SET listing_price = EXCLUDED.listing_price
      `,
      [snapshotId, snapshot.capturedAt, snapshot.listingPrice],
    );
  }
}

async function trimPostgresSnapshots(client: PoolClient, maxSnapshots: number): Promise<void> {
  await client.query(
    `
      DELETE FROM quote_snapshots
      WHERE id IN (
        SELECT id
        FROM quote_snapshots
        ORDER BY last_seen_at DESC
        OFFSET $1
      )
    `,
    [maxSnapshots],
  );
}

function snapshotFromPostgres(
  row: PostgresSnapshotRow,
  components: PostgresComponentRow[],
  history: PostgresHistoryRow[],
): QuoteSnapshot {
  return {
    id: row.id,
    capturedAt: toIso(row.captured_at),
    lastSeenAt: toIso(row.last_seen_at),
    sourceUrl: row.source_url,
    finalUrl: row.final_url,
    title: row.title,
    listingPrice: row.listing_price,
    keys: {
      cpuKey: row.cpu_key,
      ramKey: row.ram_key,
      gpuKey: row.gpu_key,
    },
    components: components
      .sort((a, b) => a.component_order - b.component_order)
      .map((component) => ({
        type: component.type,
        label: component.label,
        rawValue: component.raw_value,
        searchQuery: component.search_query,
        compuzonePrice: component.compuzone_price,
        compuzoneName: component.compuzone_name,
        bunjang: component.bunjang,
        joongna: component.joongna,
      })),
    priceHistory: history.map((entry) => ({
      capturedAt: toIso(entry.captured_at),
      listingPrice: entry.listing_price,
    })),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = map.get(groupKey);
    if (group) {
      group.push(item);
    } else {
      map.set(groupKey, [item]);
    }
  }
  return map;
}

function jsonParam(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
