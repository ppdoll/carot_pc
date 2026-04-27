import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

  configure(options: SnapshotStoreOptions = {}): this {
    if (options.filePath) {
      this.filePath = options.filePath;
    }
    if (options.maxSnapshots !== undefined) {
      this.maxSnapshots = options.maxSnapshots;
    }
    this.cache = null;
    return this;
  }

  async list(filter: SnapshotFilter = {}): Promise<QuoteSnapshot[]> {
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
    const all = await this.load();
    return {
      cpu: distinctValues(all.map((snapshot) => snapshot.keys.cpuKey)),
      ram: distinctValues(all.map((snapshot) => snapshot.keys.ramKey)),
      gpu: distinctValues(all.map((snapshot) => snapshot.keys.gpuKey)),
    };
  }

  async save(snapshot: QuoteSnapshot): Promise<void> {
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
