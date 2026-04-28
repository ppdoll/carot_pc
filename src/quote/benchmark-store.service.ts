import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalCpu, canonicalGpu } from './component-key';
import { ComponentType } from './types';

interface BenchmarkSnapshotFile {
  kind: 'cpu' | 'gpu';
  source: 'PassMark';
  chart: string;
  capturedAt: string;
  updatedAtText: string | null;
  itemCount: number;
  items: BenchmarkSnapshotItem[];
}

interface BenchmarkSnapshotItem {
  rank: number;
  name: string;
  score: number | null;
  relativeScore: number | null;
  priceUsd: string | null;
  url: string;
  sourcePage: string;
}

export interface StoredBenchmarkMatch {
  source: 'PassMark';
  itemCount: number;
  capturedAt: string;
  updatedAtText: string | null;
  item: BenchmarkSnapshotItem;
}

@Injectable()
export class BenchmarkStoreService {
  private readonly cache = new Map<'cpu' | 'gpu', Promise<BenchmarkSnapshotFile | null>>();

  async find(componentType: ComponentType, rawValue: string | null): Promise<StoredBenchmarkMatch | null> {
    if (componentType !== 'cpu' && componentType !== 'gpu') {
      return null;
    }

    const query = this.toLookupKey(componentType, rawValue);
    if (!query) {
      return null;
    }

    const snapshot = await this.loadSnapshot(componentType);
    if (!snapshot) {
      return null;
    }

    const item = snapshot.items.find((candidate) => this.matches(componentType, query, candidate.name));
    if (!item) {
      return null;
    }

    return {
      source: snapshot.source,
      itemCount: snapshot.itemCount,
      capturedAt: snapshot.capturedAt,
      updatedAtText: snapshot.updatedAtText,
      item,
    };
  }

  private loadSnapshot(componentType: 'cpu' | 'gpu') {
    const cached = this.cache.get(componentType);
    if (cached) {
      return cached;
    }

    const loading = this.readSnapshot(componentType);
    this.cache.set(componentType, loading);
    return loading;
  }


  private async readSnapshot(componentType: 'cpu' | 'gpu'): Promise<BenchmarkSnapshotFile | null> {
    const path = resolve(
      process.cwd(),
      'data',
      'benchmarks',
      componentType === 'cpu' ? 'cpu-high-end.json' : 'gpu-high-end.json',
    );

    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw) as BenchmarkSnapshotFile;
      if (!Array.isArray(parsed.items)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private toLookupKey(componentType: 'cpu' | 'gpu', rawValue: string | null) {
    return componentType === 'cpu' ? canonicalCpu(rawValue) : canonicalGpu(rawValue);
  }

  private matches(componentType: 'cpu' | 'gpu', query: string, benchmarkName: string) {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedName = benchmarkName.trim().toLowerCase();

    if (normalizedName === normalizedQuery || normalizedName.includes(normalizedQuery)) {
      return true;
    }

    const canonicalName = this.toLookupKey(componentType, benchmarkName);
    return canonicalName?.toLowerCase() === normalizedQuery;
  }
}
