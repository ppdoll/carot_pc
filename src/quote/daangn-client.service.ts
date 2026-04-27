import { Injectable } from '@nestjs/common';
import { ListingInfo } from './types';

interface ProductJsonLd {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  image?: string | string[];
  url?: string;
  offers?: {
    price?: string | number;
    priceCurrency?: string;
  };
}

@Injectable()
export class DaangnClientService {
  private readonly allowedHosts = new Set(['daangn.com', 'www.daangn.com']);
  private readonly userAgent =
    'Mozilla/5.0 (compatible; carrot-pc-estimator/0.1; +https://localhost/daangn/quotes)';

  async fetchListing(sourceUrl: string): Promise<ListingInfo> {
    const targetUrl = this.normalizeUrl(sourceUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;

    try {
      response = await fetch(targetUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'user-agent': this.userAgent,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('당근 글 요청 시간이 초과되었습니다.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`당근 글을 가져오지 못했습니다. HTTP ${response.status}`);
    }

    const html = await response.text();
    return this.parseListingFromHtml(html, response.url || targetUrl);
  }

  parseListingFromHtml(html: string, finalUrl: string, sourceUrl = finalUrl): ListingInfo {
    const product = this.findProductJsonLd(html);
    const title = product?.name || this.extractMeta(html, 'og:title') || this.extractTitle(html) || '제목 없음';
    const description =
      product?.description || this.extractMeta(html, 'og:description') || this.extractMeta(html, 'description') || '';
    const price = this.parsePrice(product?.offers?.price);
    const image = Array.isArray(product?.image) ? product?.image[0] : product?.image;
    const articleId = this.extractArticleId(html, finalUrl);

    if (!description.trim()) {
      throw new Error('당근 글 본문을 찾지 못했습니다.');
    }

    return {
      sourceUrl,
      finalUrl: product?.url || this.extractCanonicalUrl(html) || finalUrl,
      title: this.cleanText(title),
      description: this.cleanText(description),
      price,
      imageUrl: image,
      articleId,
    };
  }

  private normalizeUrl(sourceUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new Error('올바른 URL 형식이 아닙니다.');
    }

    if (parsed.protocol !== 'https:') {
      throw new Error('https 당근 URL만 분석할 수 있습니다.');
    }

    if (!this.allowedHosts.has(parsed.hostname)) {
      throw new Error('daangn.com 판매글 URL만 분석할 수 있습니다.');
    }

    return parsed.toString();
  }

  private findProductJsonLd(html: string): ProductJsonLd | null {
    const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;

    for (const match of html.matchAll(scriptPattern)) {
      try {
        const parsed = JSON.parse(match[1].trim()) as ProductJsonLd | ProductJsonLd[];
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        const product = candidates.find((candidate) => this.isProductJsonLd(candidate));
        if (product) {
          return product;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private isProductJsonLd(candidate: ProductJsonLd) {
    const type = candidate['@type'];
    return Array.isArray(type) ? type.includes('Product') : type === 'Product';
  }

  private parsePrice(value: string | number | undefined) {
    if (value == null) {
      return null;
    }

    const number = Number(String(value).replace(/[^\d.]/g, ''));
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  private extractMeta(html: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<meta\\s+(?:name|property)=["']${escaped}["'][^>]*content=["'](?<content>.*?)["'][^>]*>`,
      'is',
    );
    const match = html.match(pattern);
    return match?.groups?.content ? this.decodeHtml(match.groups.content) : null;
  }

  private extractTitle(html: string) {
    const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
    return match?.[1] ? this.decodeHtml(match[1]) : null;
  }

  private extractCanonicalUrl(html: string) {
    const match = html.match(/<link\s+rel=["']canonical["'][^>]*href=["'](?<href>.*?)["'][^>]*>/is);
    return match?.groups?.href ? this.decodeHtml(match.groups.href) : null;
  }

  private extractArticleId(html: string, finalUrl: string) {
    const fromUrl = finalUrl.match(/\/articles\/(\d+)/)?.[1];
    if (fromUrl) {
      return fromUrl;
    }

    return html.match(/karrot:\/\/articles\/(\d+)/)?.[1];
  }

  private cleanText(value: string) {
    return this.decodeHtml(value).replace(/\r\n/g, '\n').trim();
  }

  private decodeHtml(value: string) {
    return value
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }
}
