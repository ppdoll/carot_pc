import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePostgresSchema, getPostgresPool } from '../database/postgres';
import { PriceVoteKind } from '../quote/price-vote-store.service';
import { QuoteSnapshot, SnapshotStoreService } from '../quote/snapshot-store.service';

interface VoteFile {
  version?: number;
  targets?: Record<string, StoredVoteTarget>;
}

interface StoredVoteTarget {
  targetId: string;
  sourceUrl: string | null;
  finalUrl: string | null;
  title: string | null;
  voters: Record<string, StoredVoter>;
}

interface StoredVoter {
  vote: PriceVoteKind;
  votedAt: string;
}

async function main() {
  await ensurePostgresSchema();
  const snapshotCount = await importSnapshots();
  const voteCount = await importVotes();
  console.log(`Imported snapshots: ${snapshotCount}`);
  console.log(`Imported votes: ${voteCount}`);
  await getPostgresPool().end();
}

async function importSnapshots(): Promise<number> {
  const path = join(process.cwd(), 'data', 'snapshots.json');
  if (!existsSync(path)) {
    return 0;
  }

  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return 0;
  }

  const store = new SnapshotStoreService();
  let count = 0;
  for (const snapshot of parsed as QuoteSnapshot[]) {
    await store.save(snapshot);
    count += 1;
  }
  return count;
}

async function importVotes(): Promise<number> {
  const path = join(process.cwd(), 'data', 'price-votes.json');
  if (!existsSync(path)) {
    return 0;
  }

  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as VoteFile;
  const targets = parsed.targets ?? {};
  const pool = getPostgresPool();
  let count = 0;

  for (const target of Object.values(targets)) {
    for (const [voterHash, voter] of Object.entries(target.voters ?? {})) {
      await pool.query(
        `
          INSERT INTO price_votes (
            target_id, voter_hash, vote, voted_at, source_url, final_url, title
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (target_id, voter_hash) DO NOTHING
        `,
        [
          target.targetId,
          voterHash,
          voter.vote,
          voter.votedAt,
          target.sourceUrl ?? null,
          target.finalUrl ?? null,
          target.title ?? null,
        ],
      );
      count += 1;
    }
  }

  return count;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
