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

test('parses Format 2 with section headers on their own line', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`CPU

·AMD Ryzen ™ 7 7800X3D (4.2GHz, 최대 5.0 GHz)

CPU쿨러

OH'S CV-620 (블랙)

메인보드

· 기가바이트 B650M K

메모리

. Reletech DDR5-5600 16GB

그래픽

· GIGABYTE 라데온 RX 9060 XT Gaming OC D6 16GB

저장장치

· 마이크론 Crucial E100 M.2 NVMe 1TB

전원장치

· 잘만 DecaMax ET 700W 80PLUS스탠다드

케이스

· 잘만 N6 백사십 (블랙)
220(W)×375(D) ×460(H) mm
쿨링팬 : 후면 140mm LED×1, 전면 : 120mm LED ×3, 상단 : 120mm×2
HDD 베이 : 8.9cm(3.5) HDD x 2 MAX SSD베이 : 6.4cm(2.5) SSD x2 MAX`);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.detected, true);
  assert.ok(byLabel.cpu.rawValue?.includes('Ryzen 7 7800X3D'));
  assert.equal(byLabel.cooler.detected, true);
  assert.ok(byLabel.cooler.rawValue?.includes('CV-620'));
  assert.equal(byLabel.motherboard.detected, true);
  assert.equal(byLabel.motherboard.rawValue, '기가바이트 B650M K');
  assert.equal(byLabel.ram.detected, true);
  assert.equal(byLabel.ram.rawValue, 'Reletech DDR5-5600 16GB');
  assert.equal(byLabel.gpu.detected, true);
  assert.ok(byLabel.gpu.rawValue?.includes('RX 9060 XT'));
  assert.equal(byLabel.ssd.detected, true);
  assert.equal(byLabel.ssd.rawValue, '마이크론 Crucial E100 M.2 NVMe 1TB');
  assert.equal(byLabel.power.detected, true);
  assert.ok(byLabel.power.rawValue?.includes('700W'));
  assert.equal(byLabel.case.detected, true);
  assert.ok(byLabel.case.rawValue?.includes('N6'));
});

test('classifies Format 1 unlabeled lines by content patterns', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`AMD Ryzen 7 7800X3D (4.2GHz, 최대 5.0 GHz)
기가바이트 B650M K
Reletech DDR5-5600 16GB
GIGABYTE 라데온 RX 9060 XT Gaming OC D6 16GB
마이크론 Crucial E100 M.2 NVMe 1TB
잘만 DecaMax ET 700W 80PLUS스탠다드
220(W)×375(D) ×460(H) mm
쿨링팬 : 후면 140mm LED×1, 전면 : 120mm LED ×3
HDD 베이 : 8.9cm(3.5) HDD x 2 MAX SSD베이 : 6.4cm(2.5) SSD x2 MAX`);

  const byLabel = Object.fromEntries(result.map((component) => [component.type, component]));

  assert.equal(byLabel.cpu.detected, true);
  assert.ok(byLabel.cpu.rawValue?.includes('Ryzen 7 7800X3D'));
  assert.equal(byLabel.motherboard.detected, true);
  assert.ok(byLabel.motherboard.rawValue?.includes('B650M'));
  assert.equal(byLabel.ram.detected, true);
  assert.equal(byLabel.ram.rawValue, 'Reletech DDR5-5600 16GB');
  assert.equal(byLabel.gpu.detected, true);
  assert.ok(byLabel.gpu.rawValue?.includes('RX 9060 XT'));
  assert.equal(byLabel.ssd.detected, true);
  assert.ok(byLabel.ssd.rawValue?.includes('M.2 NVMe 1TB'));
  assert.equal(byLabel.power.detected, true);
  assert.ok(byLabel.power.rawValue?.includes('700W'));
});

test('ignores dimension, cooling-fan, and HDD/SSD bay metadata lines', () => {
  const service = new ComponentExtractorService();
  const result = service.extract(`220(W)×375(D) ×460(H) mm
쿨링팬 : 후면 140mm LED×1, 전면 : 120mm LED ×3
HDD 베이 : 8.9cm(3.5) HDD x 2 MAX SSD베이 : 6.4cm(2.5) SSD x2 MAX`);

  for (const component of result) {
    assert.equal(component.detected, false, `${component.type} should not be detected from metadata lines`);
  }
});
