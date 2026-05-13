import { Injectable } from '@nestjs/common';
import { ComponentType } from './types';

export interface DanawaProduct {
  pcode: string;
  name: string;
  price: number;
  url: string;
}

export interface DanawaSummary {
  searchUrl: string;
  samples: DanawaProduct[];
  averagePrice: number | null;
  sampleCount: number;
}

const CATEGORY_PATTERNS: Record<ComponentType, RegExp> = {
  cpu: /CPU/i,
  gpu: /VGA|그래픽카드/i,
  ram: /메모리|RAM/i,
  ssd: /SSD/i,
  power: /파워서플라이|파워/i,
  case: /PC케이스|케이스/i,
  motherboard: /메인보드|마더보드/i,
  cooler: /쿨러/i,
};

@Injectable()
export class DanawaClientService {
  private readonly origin = 'https://search.danawa.com';
  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  buildSearchUrl(query: string) {
    const params = new URLSearchParams({ query: query.trim().replace(/\s+/g, ' ') });
    return `${this.origin}/dsearch.php?${params.toString()}`;
  }

  async fetchSummary(componentType: ComponentType, query: string): Promise<DanawaSummary> {
    const searchUrl = this.buildSearchUrl(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response: Response;

    try {
      response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'user-agent': this.userAgent,
        },
      });
    } catch {
      clearTimeout(timeout);
      return { searchUrl, samples: [], averagePrice: null, sampleCount: 0 };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return { searchUrl, samples: [], averagePrice: null, sampleCount: 0 };
    }

    const html = await response.text();
    const samples = this.parseSamples(html, componentType).slice(0, 5);
    const averagePrice = samples.length
      ? Math.round(samples.reduce((sum, sample) => sum + sample.price, 0) / samples.length)
      : null;

    return {
      searchUrl,
      samples,
      averagePrice,
      sampleCount: samples.length,
    };
  }

  private parseSamples(html: string, componentType: ComponentType): DanawaProduct[] {
    const categoryPattern = CATEGORY_PATTERNS[componentType];
    const pricePattern = /<input\s+type="hidden"\s+id="min_price_(\d+)"\s+value="(\d+)"\s*\/>/gi;
    const products: DanawaProduct[] = [];
    const seen = new Set<string>();

    for (const match of html.matchAll(pricePattern)) {
      const pcode = match[1];
      const price = Number(match[2]);
      if (!pcode || seen.has(pcode) || !Number.isFinite(price) || price <= 0) {
        continue;
      }
      seen.add(pcode);

      const category = this.extractCategory(html, pcode);
      if (categoryPattern && !categoryPattern.test(category)) {
        continue;
      }

      const name = this.extractName(html, pcode);
      if (!name) {
        continue;
      }

      products.push({
        pcode,
        name,
        price,
        url: `https://prod.danawa.com/info/?pcode=${pcode}`,
      });
    }

    return products;
  }

  private extractCategory(html: string, pcode: string): string {
    const pattern = new RegExp(
      `<input[^>]+id="productItem_categoryInfo_${pcode}"[^>]+value="([^"]*)"`,
      'i',
    );
    return html.match(pattern)?.[1] ?? '';
  }

  private extractName(html: string, pcode: string): string {
    const pattern = new RegExp(
      `pcode=${pcode}[^"']*"[^>]*class="click_log_product_standard_title_"[^>]*[^>]*>(.*?)</a>`,
      'is',
    );
    const match = html.match(pattern);
    if (!match?.[1]) {
      return '';
    }
    return this.cleanHtml(match[1]);
  }

  private cleanHtml(value: string): string {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
