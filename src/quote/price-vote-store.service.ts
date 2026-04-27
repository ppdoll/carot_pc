import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ensurePostgresSchema, getPostgresPool, hasPostgresConfig } from '../database/postgres';

export const priceVoteKinds = ['great', 'fair', 'expensive'] as const;

export type PriceVoteKind = (typeof priceVoteKinds)[number];

export interface PriceVoteCounts {
  great: number;
  fair: number;
  expensive: number;
}

export interface PriceVoteSummary {
  targetId: string;
  counts: PriceVoteCounts;
  total: number;
  userVote: PriceVoteKind | null;
}

export interface PriceVoteResult {
  accepted: boolean;
  alreadyVoted: boolean;
  summary: PriceVoteSummary;
}

export interface PriceVoteStoreOptions {
  filePath?: string;
}

export interface RecordPriceVoteInput {
  targetId: string;
  vote: PriceVoteKind;
  clientIp: string;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  title?: string | null;
}

interface StoredVoter {
  vote: PriceVoteKind;
  votedAt: string;
}

interface StoredTarget {
  targetId: string;
  sourceUrl: string | null;
  finalUrl: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  voters: Record<string, StoredVoter>;
}

interface StoreFile {
  version: 1;
  targets: Record<string, StoredTarget>;
}

const EMPTY_COUNTS: PriceVoteCounts = {
  great: 0,
  fair: 0,
  expensive: 0,
};

@Injectable()
export class PriceVoteStoreService {
  private filePath: string = join(process.cwd(), 'data', 'price-votes.json');
  private cache: StoreFile | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private forceJsonStore = false;

  configure(options: PriceVoteStoreOptions = {}): this {
    if (options.filePath) {
      this.filePath = options.filePath;
      this.forceJsonStore = true;
    }
    this.cache = null;
    this.writeQueue = Promise.resolve();
    return this;
  }

  async summary(targetId: string, clientIp?: string | null): Promise<PriceVoteSummary> {
    if (this.shouldUsePostgres()) {
      return this.summaryFromPostgres(targetId, clientIp);
    }

    const normalizedTargetId = normalizeTargetId(targetId);
    const store = await this.load();
    const target = store.targets[normalizedTargetId];
    const voterHash = clientIp ? hashVoter(normalizedTargetId, clientIp) : null;
    return toSummary(normalizedTargetId, target, voterHash);
  }

  async vote(input: RecordPriceVoteInput): Promise<PriceVoteResult> {
    if (this.shouldUsePostgres()) {
      return this.voteToPostgres(input);
    }

    const normalizedTargetId = normalizeTargetId(input.targetId);
    const normalizedVote = normalizeVote(input.vote);
    const voterHash = hashVoter(normalizedTargetId, input.clientIp);

    return this.enqueueWrite(async () => {
      const store = await this.load();
      const now = new Date().toISOString();
      const target =
        store.targets[normalizedTargetId] ??
        createTarget(normalizedTargetId, {
          sourceUrl: input.sourceUrl,
          finalUrl: input.finalUrl,
          title: input.title,
          now,
        });

      target.sourceUrl = input.sourceUrl ?? target.sourceUrl;
      target.finalUrl = input.finalUrl ?? target.finalUrl;
      target.title = input.title ?? target.title;

      if (target.voters[voterHash]) {
        store.targets[normalizedTargetId] = target;
        return {
          accepted: false,
          alreadyVoted: true,
          summary: toSummary(normalizedTargetId, target, voterHash),
        };
      }

      target.voters[voterHash] = {
        vote: normalizedVote,
        votedAt: now,
      };
      target.updatedAt = now;
      store.targets[normalizedTargetId] = target;

      await this.persist(store);

      return {
        accepted: true,
        alreadyVoted: false,
        summary: toSummary(normalizedTargetId, target, voterHash),
      };
    });
  }

  private async load(): Promise<StoreFile> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      this.cache =
        parsed && parsed.version === 1 && parsed.targets && typeof parsed.targets === 'object'
          ? { version: 1, targets: parsed.targets as Record<string, StoredTarget> }
          : emptyStore();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = emptyStore();
      } else {
        throw error;
      }
    }

    return this.cache;
  }

  private async persist(store: StoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
    await rename(tmp, this.filePath);
  }

  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private shouldUsePostgres(): boolean {
    return !this.forceJsonStore && hasPostgresConfig();
  }

  private async summaryFromPostgres(targetId: string, clientIp?: string | null): Promise<PriceVoteSummary> {
    await ensurePostgresSchema();
    const normalizedTargetId = normalizeTargetId(targetId);
    const voterHash = clientIp ? hashVoter(normalizedTargetId, clientIp) : null;
    const pool = getPostgresPool();
    const [counts, userVote] = await Promise.all([
      pool.query<{ vote: PriceVoteKind; count: string }>(
        `
          SELECT vote, COUNT(*)::text AS count
          FROM price_votes
          WHERE target_id = $1
          GROUP BY vote
        `,
        [normalizedTargetId],
      ),
      voterHash
        ? pool.query<{ vote: PriceVoteKind }>(
            'SELECT vote FROM price_votes WHERE target_id = $1 AND voter_hash = $2 LIMIT 1',
            [normalizedTargetId, voterHash],
          )
        : Promise.resolve({ rows: [] } as { rows: { vote: PriceVoteKind }[] }),
    ]);

    return summaryFromVoteRows(
      normalizedTargetId,
      counts.rows,
      userVote.rows[0]?.vote ?? null,
    );
  }

  private async voteToPostgres(input: RecordPriceVoteInput): Promise<PriceVoteResult> {
    await ensurePostgresSchema();
    const normalizedTargetId = normalizeTargetId(input.targetId);
    const normalizedVote = normalizeVote(input.vote);
    const voterHash = hashVoter(normalizedTargetId, input.clientIp);
    const pool = getPostgresPool();
    const inserted = await pool.query(
      `
        INSERT INTO price_votes (
          target_id, voter_hash, vote, voted_at, source_url, final_url, title
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (target_id, voter_hash) DO NOTHING
      `,
      [
        normalizedTargetId,
        voterHash,
        normalizedVote,
        new Date().toISOString(),
        input.sourceUrl ?? null,
        input.finalUrl ?? null,
        input.title ?? null,
      ],
    );
    const summary = await this.summaryFromPostgres(normalizedTargetId, input.clientIp);

    return {
      accepted: inserted.rowCount === 1,
      alreadyVoted: inserted.rowCount !== 1,
      summary,
    };
  }
}

export function isPriceVoteKind(value: unknown): value is PriceVoteKind {
  return typeof value === 'string' && priceVoteKinds.includes(value as PriceVoteKind);
}

function emptyStore(): StoreFile {
  return {
    version: 1,
    targets: {},
  };
}

function createTarget(
  targetId: string,
  input: { sourceUrl?: string | null; finalUrl?: string | null; title?: string | null; now: string },
): StoredTarget {
  return {
    targetId,
    sourceUrl: input.sourceUrl ?? null,
    finalUrl: input.finalUrl ?? null,
    title: input.title ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    voters: {},
  };
}

function normalizeTargetId(targetId: string): string {
  const normalized = String(targetId ?? '').trim();
  if (!normalized) {
    throw new Error('평가 대상이 없습니다.');
  }
  return normalized.slice(0, 300);
}

function normalizeVote(vote: PriceVoteKind): PriceVoteKind {
  if (!isPriceVoteKind(vote)) {
    throw new Error('알 수 없는 평가입니다.');
  }
  return vote;
}

function normalizeIp(clientIp: string): string {
  const first = String(clientIp || 'unknown').split(',')[0]?.trim() || 'unknown';
  return first.replace(/^::ffff:/, '');
}

function hashVoter(targetId: string, clientIp: string): string {
  return createHash('sha256').update(`${targetId}|${normalizeIp(clientIp)}`).digest('hex');
}

function toSummary(targetId: string, target: StoredTarget | undefined, voterHash: string | null): PriceVoteSummary {
  const counts = { ...EMPTY_COUNTS };
  let userVote: PriceVoteKind | null = null;

  if (target) {
    for (const [hash, voter] of Object.entries(target.voters)) {
      counts[voter.vote] += 1;
      if (hash === voterHash) {
        userVote = voter.vote;
      }
    }
  }

  return {
    targetId,
    counts,
    total: counts.great + counts.fair + counts.expensive,
    userVote,
  };
}

function summaryFromVoteRows(
  targetId: string,
  rows: { vote: PriceVoteKind; count: string }[],
  userVote: PriceVoteKind | null,
): PriceVoteSummary {
  const counts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    counts[row.vote] = Number(row.count);
  }

  return {
    targetId,
    counts,
    total: counts.great + counts.fair + counts.expensive,
    userVote,
  };
}
