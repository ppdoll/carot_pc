import { Injectable } from '@nestjs/common';
import {
  UsedMarketSample,
  UsedMarketSummary,
  emptySummary,
  matchesQueryTokens,
  summarizeSamples,
  tokenizeQuery,
} from './used-market';

interface RawJoongnaItem {
  seq?: string | number;
  productId?: string | number;
  id?: string | number;
  title?: string;
  productName?: string;
  name?: string;
  price?: string | number;
  productPrice?: string | number;
  url?: string;
  thumbnail?: string;
  imageUrl?: string;
}

@Injectable()
export class JoongnaClientService {
  private readonly origin = 'https://web.joongna.com';
  private readonly userAgent =
    'Mozilla/5.0 (compatible; carrot-pc-estimator/0.1; +https://localhost/daangn/quotes)';

  async fetchSummary(query: string): Promise<UsedMarketSummary> {
    const searchUrl = this.buildSearchPageUrl(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9',
          'user-agent': this.userAgent,
        },
      });

      if (!response.ok) {
        return emptySummary('joongna', searchUrl, `HTTP ${response.status}`);
      }

      const html = await response.text();
      return this.parseHtml(html, query, searchUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? '중고나라 검색 요청 시간이 초과되었습니다.'
            : error.message
          : '중고나라 검색 중 오류가 발생했습니다.';
      return emptySummary('joongna', searchUrl, message);
    } finally {
      clearTimeout(timeout);
    }
  }

  parseHtml(html: string, query: string, searchUrl: string): UsedMarketSummary {
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(?<json>[\s\S]*?)<\/script>/);
    if (!nextDataMatch?.groups?.json) {
      return emptySummary('joongna', searchUrl, '__NEXT_DATA__ 미발견');
    }

    let data: unknown;
    try {
      data = JSON.parse(nextDataMatch.groups.json);
    } catch (error) {
      return emptySummary('joongna', searchUrl, '__NEXT_DATA__ JSON 파싱 실패');
    }

    const products = this.extractProducts(data);
    const tokens = tokenizeQuery(query);

    const samples = products
      .map((item) => this.toSample(item))
      .filter((sample): sample is UsedMarketSample => Boolean(sample))
      .filter((sample) => matchesQueryTokens(sample.name, tokens))
      .slice(0, 10);

    return summarizeSamples('joongna', searchUrl, samples);
  }

  buildSearchPageUrl(query: string) {
    return `${this.origin}/search/${encodeURIComponent(this.normalize(query))}`;
  }

  private extractProducts(data: unknown): RawJoongnaItem[] {
    const found: RawJoongnaItem[] = [];
    const seen = new WeakSet<object>();

    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') {
        return;
      }
      if (seen.has(node as object)) {
        return;
      }
      seen.add(node as object);

      if (Array.isArray(node)) {
        if (this.looksLikeItemArray(node)) {
          for (const item of node) {
            if (item && typeof item === 'object') {
              found.push(item as RawJoongnaItem);
            }
          }
        }
        for (const child of node) {
          visit(child);
        }
        return;
      }

      for (const value of Object.values(node as Record<string, unknown>)) {
        visit(value);
      }
    };

    visit(data);
    return found;
  }

  private looksLikeItemArray(arr: unknown[]): boolean {
    if (arr.length === 0) {
      return false;
    }

    const sample = arr[0];
    if (!sample || typeof sample !== 'object') {
      return false;
    }

    const keys = new Set(Object.keys(sample as Record<string, unknown>));
    const hasTitle = keys.has('title') || keys.has('productName') || keys.has('name');
    const hasPrice = keys.has('price') || keys.has('productPrice');
    return hasTitle && hasPrice;
  }

  private toSample(item: RawJoongnaItem): UsedMarketSample | null {
    const name = String(item?.title ?? item?.productName ?? item?.name ?? '').trim();
    const rawPrice = item?.price ?? item?.productPrice;
    const price = Number(typeof rawPrice === 'string' ? rawPrice.replace(/[^\d]/g, '') : rawPrice);
    const seq = item?.seq ?? item?.productId ?? item?.id;

    if (!name || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    const url = seq
      ? `${this.origin}/product/${seq}`
      : typeof item?.url === 'string'
        ? new URL(item.url, this.origin).toString()
        : this.origin;

    return {
      name,
      price,
      url,
      imageUrl:
        typeof item?.thumbnail === 'string'
          ? item.thumbnail
          : typeof item?.imageUrl === 'string'
            ? item.imageUrl
            : undefined,
    };
  }

  private normalize(query: string) {
    return query.trim().replace(/\s+/g, ' ');
  }
}
