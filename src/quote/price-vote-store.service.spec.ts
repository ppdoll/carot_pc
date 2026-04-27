import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PriceVoteStoreService } from './price-vote-store.service';

test('price vote store counts one vote per target and IP', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'votes-'));
  try {
    const store = new PriceVoteStoreService().configure({ filePath: join(dir, 'price-votes.json') });

    const first = await store.vote({
      targetId: 'daangn:123',
      vote: 'great',
      clientIp: '203.0.113.10',
      title: 'listing',
    });
    const duplicate = await store.vote({
      targetId: 'daangn:123',
      vote: 'expensive',
      clientIp: '203.0.113.10',
    });
    const otherIp = await store.vote({
      targetId: 'daangn:123',
      vote: 'fair',
      clientIp: '203.0.113.11',
    });

    assert.equal(first.accepted, true);
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.alreadyVoted, true);
    assert.equal(otherIp.accepted, true);
    assert.deepEqual(otherIp.summary.counts, {
      great: 1,
      fair: 1,
      expensive: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('price vote store keeps the same IP independent across listings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'votes-'));
  try {
    const store = new PriceVoteStoreService().configure({ filePath: join(dir, 'price-votes.json') });

    await store.vote({
      targetId: 'daangn:123',
      vote: 'great',
      clientIp: '203.0.113.10',
    });
    const secondListing = await store.vote({
      targetId: 'daangn:456',
      vote: 'expensive',
      clientIp: '203.0.113.10',
    });
    const firstSummary = await store.summary('daangn:123', '203.0.113.10');

    assert.equal(secondListing.accepted, true);
    assert.deepEqual(secondListing.summary.counts, {
      great: 0,
      fair: 0,
      expensive: 1,
    });
    assert.equal(firstSummary.userVote, 'great');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
