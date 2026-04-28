import test from 'node:test';
import assert from 'node:assert/strict';
import { DaangnClientService } from './daangn-client.service';

test('parses daangn product json-ld from html', () => {
  const service = new DaangnClientService();
  const html = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "게이밍컴퓨터",
            "description": "CPU : i5-9400F\\nGPU : RTX 2060",
            "url": "https://www.daangn.com/kr/buy-sell/sample/",
            "offers": {"@type": "Offer", "price": "500000.0", "priceCurrency": "KRW"}
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const listing = service.parseListingFromHtml(html, 'https://www.daangn.com/articles/1');

  assert.equal(listing.title, '게이밍컴퓨터');
  assert.equal(listing.description, 'CPU : i5-9400F\nGPU : RTX 2060');
  assert.equal(listing.price, 500000);
  assert.equal(listing.finalUrl, 'https://www.daangn.com/kr/buy-sell/sample/');
});

test('extracts the daangn url from pasted share text', async () => {
  const service = new DaangnClientService();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return {
      ok: true,
      url: 'https://www.daangn.com/articles/1161594859',
      text: async () => `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "sample",
                "description": "CPU : i5-9400F",
                "url": "https://www.daangn.com/articles/1161594859",
                "offers": {"@type": "Offer", "price": "500000", "priceCurrency": "KRW"}
              }
            </script>
          </head>
          <body></body>
        </html>
      `,
    } as Response;
  }) as typeof fetch;

  try {
    const listing = await service.fetchListing(
      '당근에서 이 글을 확인해보세요!\n\nhttps://www.daangn.com/articles/1161594859',
    );

    assert.equal(requestedUrl, 'https://www.daangn.com/articles/1161594859');
    assert.equal(listing.sourceUrl, 'https://www.daangn.com/articles/1161594859');
    assert.equal(listing.finalUrl, 'https://www.daangn.com/articles/1161594859');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
