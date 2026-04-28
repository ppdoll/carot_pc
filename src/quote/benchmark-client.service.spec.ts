import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BenchmarkClientService } from './benchmark-client.service';
import { BenchmarkStoreService } from './benchmark-store.service';

test('reads CPU benchmark info from local snapshot data', async () => {
  await withTempCwd(async () => {
    await writeBenchmarkFixture('cpu-high-end.json', {
      kind: 'cpu',
      source: 'PassMark',
      chart: 'high_end_multithread',
      capturedAt: '2026-04-27T00:00:00.000Z',
      updatedAtText: '27th of April 2026',
      itemCount: 2,
      items: [
        {
          rank: 1,
          name: 'AMD Ryzen 7 7800X3D',
          score: 34567,
          relativeScore: 80,
          priceUsd: '$399.00*',
          url: 'https://www.cpubenchmark.net/cpu.php?cpu=AMD+Ryzen+7+7800X3D&id=0001',
          sourcePage: 'fixture',
        },
        {
          rank: 2,
          name: 'Intel Core i5-10400',
          score: 11983,
          relativeScore: 45,
          priceUsd: 'NA',
          url: 'https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+i5-10400&id=0002',
          sourcePage: 'fixture',
        },
      ],
    });

    const service = new BenchmarkClientService(new BenchmarkStoreService());
    const result = await service.fetchBenchmark('cpu', 'Intel i5-10400');

    assert.ok(result);
    assert.equal(result.status, 'ok');
    assert.equal(result.rank, 2);
    assert.equal(result.rankTotal, 2);
    assert.equal(result.score, 11983);
    assert.equal(result.scoreLabel, 'CPU Mark');
    assert.equal(result.url, 'https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+i5-10400&id=0002');
  });
});

test('reads GPU benchmark info from local snapshot data', async () => {
  await withTempCwd(async () => {
    await writeBenchmarkFixture('gpu-high-end.json', {
      kind: 'gpu',
      source: 'PassMark',
      chart: 'high_end',
      capturedAt: '2026-04-27T00:00:00.000Z',
      updatedAtText: null,
      itemCount: 1,
      items: [
        {
          rank: 1,
          name: 'GeForce RTX 2060',
          score: 14094,
          relativeScore: 25,
          priceUsd: null,
          url: 'https://www.videocardbenchmark.net/gpu.php?gpu=GeForce+RTX+2060&id=0003',
          sourcePage: 'fixture',
        },
      ],
    });

    const service = new BenchmarkClientService(new BenchmarkStoreService());
    const result = await service.fetchBenchmark('gpu', 'GeForce RTX 2060 6GB');

    assert.ok(result);
    assert.equal(result.status, 'ok');
    assert.equal(result.rank, 1);
    assert.equal(result.rankTotal, 1);
    assert.equal(result.score, 14094);
    assert.equal(result.scoreLabel, 'G3D Mark');
    assert.equal(result.url, 'https://www.videocardbenchmark.net/gpu.php?gpu=GeForce+RTX+2060&id=0003');
  });
});

async function writeBenchmarkFixture(filename: string, data: unknown) {
  const directory = resolve(process.cwd(), 'data', 'benchmarks');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, filename), JSON.stringify(data, null, 2), 'utf-8');
}

async function withTempCwd(run: () => Promise<void>) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'benchmark-client-spec-'));

  try {
    process.chdir(tempDir);
    await run();
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}
