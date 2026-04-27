import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCpu, canonicalGpu, canonicalRam } from './component-key';

test('canonicalCpu normalizes intel core, xeon, and ryzen', () => {
  assert.equal(canonicalCpu('Intel i5-9400F'), 'i5-9400F');
  assert.equal(canonicalCpu('인텔 i7 9700k'), 'i7-9700K');
  assert.equal(canonicalCpu('Xeon E5-2680 v4(14코어 28스레드)'), 'Xeon E5-2680 v4');
  assert.equal(canonicalCpu('AMD Ryzen 5 5600x'), 'Ryzen 5 5600X');
  assert.equal(canonicalCpu(null), null);
  assert.equal(canonicalCpu('something else'), null);
});

test('canonicalRam returns size in GB', () => {
  assert.equal(canonicalRam('DDR4 16GB'), '16GB');
  assert.equal(canonicalRam('16G'), '16GB');
  assert.equal(canonicalRam('메모리 32 gb'), '32GB');
  assert.equal(canonicalRam(''), null);
});

test('canonicalGpu normalizes nvidia and amd', () => {
  assert.equal(canonicalGpu('GeForce RTX 2060 6GB'), 'RTX 2060');
  assert.equal(canonicalGpu('GTX 1660 Super'), 'GTX 1660 Super');
  assert.equal(canonicalGpu('Radeon RX 6700 XT'), 'RX 6700 XT');
  assert.equal(canonicalGpu(null), null);
});
