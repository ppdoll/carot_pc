import test from 'node:test';
import assert from 'node:assert/strict';
import { ComponentExtractorService } from './component-extractor.service';

test('extracts labeled pc parts from a daangn style description', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
CPU : i5-9400F
RAM : 16GB
SSD : 1TB
GPU : GTX1060 3GB
BOARD : B760M DS3H
COOLER : AG400
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.rawValue, 'i5-9400F');
  assert.equal(byLabel.gpu.rawValue, 'GTX1060 3GB');
  assert.equal(byLabel.ram.rawValue, '16GB');
  assert.equal(byLabel.ssd.searchQuery, '1TB SSD');
  assert.equal(byLabel.motherboard.searchQuery, 'B760M DS3H motherboard');
  assert.equal(byLabel.cooler.searchQuery, 'AG400 cooler');
  assert.equal(byLabel.power.detected, false);
});

test('strips parentheticals and English brand tokens from search query', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
CPU: Xeon E5-2680 v4(14코어 28스레드)
GPU: GeForce RTX 2060 6GB
SSD: M.2 NVME 256GB(신형)
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.searchQuery, 'Xeon E5-2680 v4');
  assert.equal(byLabel.gpu.searchQuery, 'RTX 2060 6GB');
  assert.equal(byLabel.ssd.searchQuery, 'M.2 NVME 256GB SSD');
  assert.equal(byLabel.cpu.rawValue, 'Xeon E5-2680 v4(14코어 28스레드)');
});

test('drops asterisk side-note lines and trailing Korean prose', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
CPU: Intel Xeon E5-2680 v4(14코어 28스레드)
  *I9 9900 동급 성능
  *파워: 정격 500W 80 브론즈
케이스: 어항케이스 설명이 길어져도 검색에는 모델명만 남겨야 합니다
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.rawValue, 'Xeon E5-2680 v4(14코어 28스레드)');
  assert.equal(byLabel.power.detected, false);
  assert.equal(byLabel.case.rawValue, '어항케이스');
});

test('extracts Korean component labels and unlabeled CPU line', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
컴퓨터 사양
인텔 i5-9400F
그래픽카드: 지포스 RTX 3060 12G
메모리: DDR4 16GB
저장장치: SSD 250GB
케이스 : 신형 어항케이스
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.rawValue, 'Intel i5-9400F');
  assert.equal(byLabel.gpu.rawValue, 'GeForce RTX 3060 12G');
  assert.equal(byLabel.ram.rawValue, 'DDR4 16GB');
  assert.equal(byLabel.case.rawValue, '신형 어항케이스');
});

test('extracts motherboard and cooler from labeled lines', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
메인보드: ASUS B650M-A WIFI
쿨러: DEEPCOOL AG400
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.motherboard.rawValue, 'ASUS B650M-A WIFI');
  assert.equal(byLabel.motherboard.searchQuery, 'ASUS B650M-A WIFI motherboard');
  assert.equal(byLabel.cooler.rawValue, 'DEEPCOOL AG400');
  assert.equal(byLabel.cooler.searchQuery, 'DEEPCOOL AG400 cooler');
});

test('keeps model identifiers around Korean codename tokens for motherboard search', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`
보드: msi 프로젝트 제로 b650 btf
쿨러: MSI MAG B760M 박격포 WIFI
  `);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.motherboard.searchQuery, 'msi b650 btf motherboard');
  assert.equal(byLabel.cooler.searchQuery, 'MSI MAG B760M WIFI cooler');
});
