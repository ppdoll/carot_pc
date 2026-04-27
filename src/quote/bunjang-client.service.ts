import { Injectable } from '@nestjs/common';
import {
  UsedMarketSample,
  UsedMarketSummary,
  emptySummary,
  matchesQueryTokens,
  summarizeSamples,
  tokenizeQuery,
} from './used-market';

interface RawBunjangItem {
  pid?: string | number;
  uid?: string | number;
  name?: string;
  price?: string | number;
  product_image?: string;
  status?: string | number;
}

@Injectable()
export class BunjangClientService {
  private readonly apiOrigin = 'https://api.bunjang.co.kr';
  private readonly webOrigin = 'https://m.bunjang.co.kr';
  private readonly userAgent =
    'Mozilla/5.0 (compatible; carrot-pc-estimator/0.1; +https://localhost/admin/quotes)';

  async fetchSummary(query: string): Promise<UsedMarketSummary> {
    const searchUrl = this.buildSearchPageUrl(query);
    const apiUrl = this.buildApiUrl(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': this.userAgent,
          referer: `${this.webOrigin}/`,
        },
      });

      if (!response.ok) {
        return emptySummary('bunjang', searchUrl, `HTTP ${response.status}`);
      }

      const data = (await response.json()) as { list?: RawBunjangItem[] };
      return this.parseList(data, query, searchUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? '번개장터 검색 요청 시간이 초과되었습니다.'
            : error.message
          : '번개장터 검색 중 오류가 발생했습니다.';
      return emptySummary('bunjang', searchUrl, message);
    } finally {
      clearTimeout(timeout);
    }
  }

  parseList(data: { list?: RawBunjangItem[] }, query: string, searchUrl: string): UsedMarketSummary {
    const list = Array.isArray(data?.list) ? data.list : [];
    const tokens = tokenizeQuery(query);

    const samples = list
      .map((item) => this.toSample(item))
      .filter((sample): sample is UsedMarketSample => Boolean(sample))
      .filter((sample) => matchesQueryTokens(sample.name, tokens))
      .slice(0, 10);

    return summarizeSamples('bunjang', searchUrl, samples);
  }

  buildSearchPageUrl(query: string) {
    const params = new URLSearchParams({ q: this.normalize(query) });
    return `${this.webOrigin}/search/products?${params.toString()}`;
  }

  private buildApiUrl(query: string) {
    const params = new URLSearchParams({
      q: this.normalize(query),
      order: 'score',
      page: '0',
      n: '20',
      stat_device: 'w',
      version: '4',
    });
    return `${this.apiOrigin}/api/1/find_v2.json?${params.toString()}`;
  }

  private toSample(item: RawBunjangItem): UsedMarketSample | null {
    const name = String(item?.name ?? '').trim();
    const price = Number(item?.price);
    const pid = item?.pid ?? item?.uid;

    if (!name || !pid || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    if (item?.status !== undefined && Number(item.status) !== 0) {
      return null;
    }

    return {
      name,
      price,
      url: `${this.webOrigin}/products/${pid}`,
      imageUrl: typeof item?.product_image === 'string' ? item.product_image : undefined,
    };
  }

  private normalize(query: string) {
    return query.trim().replace(/\s+/g, ' ');
  }
}
