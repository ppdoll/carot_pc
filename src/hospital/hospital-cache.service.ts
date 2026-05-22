import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FILE_PATH = join(process.cwd(), 'data', 'hospital-cache.json');

interface CacheEntry {
  data: unknown;
  cachedAt: number;
}

@Injectable()
export class HospitalCacheService implements OnModuleInit {
  private readonly store = new Map<string, CacheEntry>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  async onModuleInit() {
    try {
      const raw = await readFile(FILE_PATH, 'utf-8');
      const obj = JSON.parse(raw) as Record<string, CacheEntry>;
      const cutoff = Date.now() - TTL_MS;
      for (const [key, entry] of Object.entries(obj)) {
        if (entry.cachedAt > cutoff) this.store.set(key, entry);
      }
    } catch {
      // 파일 없으면 빈 캐시로 시작
    }
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown): void {
    this.store.set(key, { data, cachedAt: Date.now() });
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.persist();
    }, 2000);
  }

  private async persist() {
    try {
      await mkdir(dirname(FILE_PATH), { recursive: true });
      const obj = Object.fromEntries(this.store.entries());
      await writeFile(FILE_PATH, JSON.stringify(obj));
    } catch {
      // 저장 실패해도 서비스는 계속 동작
    }
  }
}
