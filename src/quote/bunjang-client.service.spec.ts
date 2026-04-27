import test from 'node:test';
import assert from 'node:assert/strict';
import { BunjangClientService } from './bunjang-client.service';

test('parses bunjang find_v2 response, drops sold items, and computes trimmed mean', () => {
  const service = new BunjangClientService();
  const data = {
    list: [
      { pid: '1', name: 'RTX 2060 6GB MSI 게이밍', price: '120000', status: '0' },
      { pid: '2', name: 'RTX 2060 6GB 기가바이트 OC', price: '130000', status: '0' },
      { pid: '3', name: 'RTX 2060 6GB SUPER', price: '180000', status: '0' },
      { pid: '4', name: 'RTX 2060 6GB 컬러풀', price: '110000', status: '0' },
      { pid: '5', name: 'RTX 2060 6GB ZOTAC', price: '140000', status: '0' },
      { pid: '6', name: 'RTX 2060 사은품 노트북', price: '500', status: '2' },
      { pid: '7', name: '쿨링 패드 RTX 호환', price: '5000', status: '0' },
      { pid: '8', name: 'RTX 2060 6GB 갤럭시', price: '125000', status: '0' },
    ],
  };

  const summary = service.parseList(data, 'RTX 2060 6GB', 'https://m.bunjang.co.kr/search/products?q=RTX+2060+6GB');

  assert.equal(summary.source, 'bunjang');
  assert.equal(summary.sampleCount, 6);
  assert.equal(summary.minPrice, 110000);
  assert.equal(summary.maxPrice, 180000);
  assert.ok(summary.averagePrice && summary.averagePrice > 110000 && summary.averagePrice < 180000);
});

test('builds bunjang search page url with normalized spacing', () => {
  const service = new BunjangClientService();
  const url = service.buildSearchPageUrl('  RTX   2060   6GB ');
  assert.match(url, /q=RTX\+2060\+6GB/);
});
