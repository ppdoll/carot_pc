import test from 'node:test';
import assert from 'node:assert/strict';
import { JoongnaClientService } from './joongna-client.service';

test('parses joongna __NEXT_DATA__ payload and computes summary', () => {
  const service = new JoongnaClientService();
  const payload = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              state: {
                data: {
                  data: {
                    items: [
                      { seq: 100, title: 'RTX 2060 6GB MSI', price: 150000 },
                      { seq: 101, title: 'RTX 2060 6GB ASUS', price: 170000 },
                      { seq: 102, title: 'RTX 2060 6GB GIGABYTE', price: 145000 },
                      { seq: 103, title: '쿨러 RTX 호환', price: 9000 },
                      { seq: 104, title: 'RTX 2060 6GB SUPER ZOTAC', price: 200000 },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    },
  };

  const html = `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;

  const summary = service.parseHtml(html, 'RTX 2060 6GB', 'https://web.joongna.com/search/RTX%202060%206GB');

  assert.equal(summary.source, 'joongna');
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.minPrice, 145000);
  assert.equal(summary.maxPrice, 200000);
  assert.ok(summary.averagePrice);
});

test('returns empty summary with error when next data is missing', () => {
  const service = new JoongnaClientService();
  const summary = service.parseHtml('<html><body></body></html>', 'RTX', 'https://web.joongna.com/search/RTX');
  assert.equal(summary.sampleCount, 0);
  assert.equal(summary.averagePrice, null);
  assert.match(String(summary.error), /__NEXT_DATA__/);
});
