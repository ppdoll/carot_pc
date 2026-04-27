import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuoteSnapshot, SnapshotStoreService } from './snapshot-store.service';

function makeComponent(rawValue = 'RTX 2060') {
  return {
    type: 'gpu',
    label: 'GPU',
    rawValue,
    searchQuery: `${rawValue} 6GB`,
    compuzonePrice: 200000,
    compuzoneName: rawValue,
    bunjang: null,
    joongna: null,
  };
}

function makeSnapshot(id: string, capturedAt: string, overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    id,
    capturedAt,
    sourceUrl: `https://example.test/${id}`,
    finalUrl: `https://example.test/${id}`,
    title: `Snapshot ${id}`,
    listingPrice: 100000,
    keys: {
      cpuKey: overrides.keys?.cpuKey ?? 'i5-9400F',
      ramKey: overrides.keys?.ramKey ?? '16GB',
      gpuKey: overrides.keys?.gpuKey ?? 'RTX 2060',
    },
    components: [],
    ...overrides,
  };
}

test('snapshot store keeps newest 50 entries (FIFO eviction)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json'), maxSnapshots: 50 });
    for (let i = 0; i < 60; i += 1) {
      await store.save(makeSnapshot(`s${i}`, new Date(2026, 3, 1, 0, 0, i).toISOString()));
    }
    const all = await store.list();
    assert.equal(all.length, 50);
    assert.equal(all[0].id, 's59');
    assert.equal(all.at(-1)?.id, 's10');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot store filters by cpu/ram/gpu (substring, case-insensitive)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json') });
    await store.save(makeSnapshot('a', '2026-04-24T10:00:00.000Z', { keys: { cpuKey: 'i5-9400F', ramKey: '16GB', gpuKey: 'RTX 2060' } }));
    await store.save(makeSnapshot('b', '2026-04-24T11:00:00.000Z', { keys: { cpuKey: 'Xeon E5-2680 v4', ramKey: '32GB', gpuKey: 'RTX 3060' } }));
    await store.save(makeSnapshot('c', '2026-04-24T12:00:00.000Z', { keys: { cpuKey: 'Ryzen 5 5600X', ramKey: '16GB', gpuKey: 'RTX 2060 Super' } }));

    const byCpu = await store.list({ cpu: 'xeon' });
    assert.deepEqual(byCpu.map((s) => s.id), ['b']);

    const byRam = await store.list({ ram: '16gb' });
    assert.deepEqual(byRam.map((s) => s.id), ['c', 'a']);

    const byGpu = await store.list({ gpu: 'rtx 2060' });
    assert.deepEqual(byGpu.map((s) => s.id), ['c', 'a']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot store distinctKeys returns sorted unique values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json') });
    await store.save(makeSnapshot('a', '2026-04-24T10:00:00.000Z', { keys: { cpuKey: 'i5-9400F', ramKey: '16GB', gpuKey: 'RTX 2060' } }));
    await store.save(makeSnapshot('b', '2026-04-24T11:00:00.000Z', { keys: { cpuKey: 'i5-9400F', ramKey: '32GB', gpuKey: null } }));

    const distinct = await store.distinctKeys();
    assert.deepEqual(distinct.cpu, ['i5-9400F']);
    assert.deepEqual(distinct.ram, ['16GB', '32GB']);
    assert.deepEqual(distinct.gpu, ['RTX 2060']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot store does not duplicate same URL, same components, and same price', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json') });
    const first = makeSnapshot('a', '2026-04-24T10:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1?utm=old',
      listingPrice: 550000,
      components: [makeComponent()],
    });
    const duplicate = makeSnapshot('b', '2026-04-24T11:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1',
      listingPrice: 550000,
      components: [makeComponent()],
    });

    await store.save(first);
    await store.save(duplicate);

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'a');
    assert.equal(all[0].listingPrice, 550000);
    assert.equal(all[0].priceHistory?.length, 1);
    assert.equal(all[0].lastSeenAt, '2026-04-24T11:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot store keeps price change history for same URL and components', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json') });
    await store.save(makeSnapshot('a', '2026-04-24T10:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1',
      listingPrice: 560000,
      components: [makeComponent()],
    }));
    await store.save(makeSnapshot('b', '2026-04-24T11:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1',
      listingPrice: 550000,
      components: [makeComponent()],
    }));

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'a');
    assert.equal(all[0].listingPrice, 550000);
    assert.deepEqual(
      all[0].priceHistory?.map((entry) => entry.listingPrice),
      [560000, 550000],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snapshot store keeps separate entries when components changed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-'));
  try {
    const store = new SnapshotStoreService().configure({ filePath: join(dir, 'snapshots.json') });
    await store.save(makeSnapshot('a', '2026-04-24T10:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1',
      listingPrice: 550000,
      components: [makeComponent('RTX 2060')],
    }));
    await store.save(makeSnapshot('b', '2026-04-24T11:00:00.000Z', {
      finalUrl: 'https://example.test/listing/1',
      listingPrice: 550000,
      components: [makeComponent('RTX 3060')],
    }));

    const all = await store.list();
    assert.equal(all.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
