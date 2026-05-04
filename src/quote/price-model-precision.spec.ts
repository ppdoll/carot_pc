import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPreciseUsedMarketModel } from './price-model-precision';

test('price model precision accepts identifiable CPU, GPU, and branded memory models', () => {
  assert.equal(hasPreciseUsedMarketModel('cpu', 'Xeon E5-2680 v4(14코어 28스레드)'), true);
  assert.equal(hasPreciseUsedMarketModel('gpu', 'GeForce RTX 2060 6GB'), true);
  assert.equal(hasPreciseUsedMarketModel('ram', '하이닉스 DDR4 16GB'), true);
});

test('price model precision rejects generic category descriptions', () => {
  assert.equal(hasPreciseUsedMarketModel('case', '어항케이스'), false);
  assert.equal(hasPreciseUsedMarketModel('power', '정격 500W 80 브론즈'), false);
  assert.equal(hasPreciseUsedMarketModel('ssd', 'M.2 NVME 256GB(신형)'), false);
});

test('price model precision accepts branded or coded case, power, and storage values', () => {
  assert.equal(hasPreciseUsedMarketModel('case', 'ABKO VENTI PM50'), true);
  assert.equal(hasPreciseUsedMarketModel('power', '마이크로닉스 Classic II 500W'), true);
  assert.equal(hasPreciseUsedMarketModel('ssd', 'WD SN530 M.2 NVMe SSD 256GB'), true);
});

test('price model precision accepts identifiable motherboard and cooler models', () => {
  assert.equal(hasPreciseUsedMarketModel('motherboard', 'ASUS B650M-A WIFI'), true);
  assert.equal(hasPreciseUsedMarketModel('cooler', 'DEEPCOOL AG400'), true);
});

test('price model precision rejects generic motherboard and cooler labels', () => {
  assert.equal(hasPreciseUsedMarketModel('motherboard', '메인보드'), false);
  assert.equal(hasPreciseUsedMarketModel('cooler', '쿨러'), false);
});
