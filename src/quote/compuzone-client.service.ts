import { Injectable } from '@nestjs/common';
import { ComponentType, CompuzoneProduct } from './types';

@Injectable()
export class CompuzoneClientService {
  private readonly origin = 'https://www.compuzone.co.kr';
  private readonly userAgent =
    'Mozilla/5.0 (compatible; carrot-pc-estimator/0.1; +https://localhost/daangn/quotes)';

  async searchProducts(componentType: ComponentType, query: string): Promise<CompuzoneProduct[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response: Response;

    try {
      response = await fetch(this.buildAjaxUrl(query), {
        signal: controller.signal,
        headers: {
          accept: 'text/html,*/*;q=0.8',
          'user-agent': this.userAgent,
          referer: this.buildSearchPageUrl(query),
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('컴퓨존 검색 요청 시간이 초과되었습니다.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`컴퓨존 검색 실패: HTTP ${response.status}`);
    }

    const html = await this.readResponseText(response);
    return this.parseProductsFromHtml(html, componentType, query);
  }

  parseProductsFromHtml(html: string, componentType: ComponentType, query: string): CompuzoneProduct[] {
    const items = this.splitProductItems(html)
      .map((segment) => this.parseProduct(segment, componentType, query))
      .filter((product): product is CompuzoneProduct => Boolean(product))
      .sort((a, b) => b.score - a.score || (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));

    return items.filter((item) => item.score > 0).slice(0, 5);
  }

  buildSearchPageUrl(query: string) {
    return `${this.origin}/search/search.htm?SearchProductKey=${this.encodeForCompuzone(query)}`;
  }

  private buildAjaxUrl(query: string) {
    const params = new URLSearchParams({
      actype: 'list',
      SearchType: 'small',
      SearchText: query,
      PreOrder: 'low_price',
      PageCount: '10',
      StartNum: '0',
      PageNum: '1',
      ListType: '0',
      BigDivNo: '',
      MediumDivNo: '',
      DivNo: '',
      MinPrice: '0',
      MaxPrice: '0',
      WhereQueryr: '',
      MidArray: '',
      SearchBottom: '',
      SchMakerNo: '',
      SearchMaker: '',
      MakerOrder: '',
      SearchPrdMaker: '',
      stock_check_N: '',
      evt_check: '',
      freight_check: '',
      compuzone_delivery: '',
      medi_count: '',
      BigDivIndex: '',
      sch_ink_printer: '',
      ChkMakerNo: '',
    });

    return `${this.origin}/search/search_list.php?${params.toString()}`;
  }

  private splitProductItems(html: string) {
    const starts = [...html.matchAll(/<li\b[^>]*id=["']li-pno-\d+["'][^>]*>/gi)].map((match) => match.index ?? 0);
    return starts.map((start, index) => html.slice(start, starts[index + 1] ?? html.length));
  }

  private parseProduct(segment: string, componentType: ComponentType, query: string): CompuzoneProduct | null {
    const productNo = segment.match(/id=["']li-pno-(\d+)["']/i)?.[1];
    const name = this.extractAnchorText(segment, /class=["'][^"']*\bprd_info_name\b[^"']*\bprdTxt\b[^"']*["']/i);
    const summary = this.extractClassText(segment, 'prd_subTxt');
    const rawPrice =
      segment.match(/data-discountprice=["']([\d,]+)["']/i)?.[1] ||
      segment.match(/data-price=["']([\d,]+)["']/i)?.[1] ||
      segment.match(/<strong[^>]*class=["']number["'][^>]*>(.*?)<\/strong>/is)?.[1];
    const price = this.parsePrice(rawPrice);
    const href = segment.match(/href=["'](?<href>\.\.\/product\/product_detail\.htm\?[^"']+)["']/i)?.groups?.href;
    const imageUrl = segment.match(/<img[^>]+src=["'](?<src>https?:\/\/[^"']+)["']/i)?.groups?.src;

    if (!productNo || !name) {
      return null;
    }

    const product: CompuzoneProduct = {
      productNo,
      name,
      summary,
      price,
      priceText: price ? `${price.toLocaleString('ko-KR')}원` : '-',
      url: href ? new URL(href.replace(/^\.\.\//, '/'), this.origin).toString() : `${this.origin}/product/product_detail.htm?ProductNo=${productNo}`,
      imageUrl,
      score: 0,
    };

    product.score = this.scoreProduct(product, componentType, query);
    return product;
  }

  private extractAnchorText(segment: string, classPattern: RegExp) {
    const anchorPattern = new RegExp(`<a\\b(?=[^>]*${classPattern.source})[^>]*>(?<text>.*?)<\\/a>`, 'is');
    const match = segment.match(anchorPattern);
    return match?.groups?.text ? this.cleanHtml(match.groups.text) : '';
  }

  private extractClassText(segment: string, className: string) {
    const pattern = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>(?<text>.*?)<\\/div>`, 'is');
    const match = segment.match(pattern);
    return match?.groups?.text ? this.cleanHtml(match.groups.text) : '';
  }

  private scoreProduct(product: CompuzoneProduct, componentType: ComponentType, query: string) {
    const haystack = `${product.name} ${product.summary}`.toLowerCase();
    const queryTokens = query
      .toLowerCase()
      .split(/[\s/()[\],]+/)
      .filter((token) => token.length >= 2);

    let score = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        score += token.length >= 4 ? 3 : 1;
      } else if (/\d/.test(token)) {
        score -= 3;
      }
    }

    score += this.typeScore(componentType, haystack);

    if (this.looksLikeCompletePc(haystack)) {
      score -= 8;
    }

    if (this.looksLikeAccessory(componentType, haystack)) {
      score -= 7;
    }

    if (!product.price) {
      score -= 2;
    }

    return score;
  }

  private typeScore(componentType: ComponentType, haystack: string) {
    const patterns: Record<ComponentType, RegExp[]> = {
      cpu: [/라이젠|ryzen|인텔|intel|core|xeon|\bi[3579][-\s]?\d/i],
      gpu: [/그래픽|지포스|geforce|radeon|라데온|\brtx\b|\bgtx\b|\brx\s*\d/i],
      ram: [/메모리|\bram\b|\bddr[345]\b/i],
      ssd: [/\bssd\b|\bnvme\b|\bm\.?2\b/i],
      power: [/파워|power|psu|정격|80\s*(?:plus|브론즈|골드)|\d{3,4}\s*w/i],
      case: [/케이스|case|미들\s*타워|빅\s*타워|어항/i],
      motherboard: [/motherboard|mainboard|\bboard\b|\bmb\b|메인보드|보드|\b(?:h|b|z|x|a)\d{3,4}\b|\blga\s*\d+\b|\bam[45]\b/i],
      cooler: [/cooler|cpu\s*cooler|aio|air\s*cooler|radiator|heatsink|수냉|공랭|쿨러/i],
    };

    return patterns[componentType].some((pattern) => pattern.test(haystack)) ? 5 : -3;
  }

  private looksLikeCompletePc(haystack: string) {
    return /조립pc|추천\s*조립|게이밍\s*pc|본체|데스크탑|desktop|워크스테이션|프리미엄pc/i.test(haystack);
  }

  private looksLikeAccessory(componentType: ComponentType, haystack: string) {
    const patterns: Record<ComponentType, RegExp> = {
      cpu: /쿨러|써멀|브라켓|가이드|cooler|thermal|bracket/i,
      gpu: /지지대|라이저|케이블|쿨러|백플레이트|support|riser|cable/i,
      ram: /usb\s*메모리|메모리카드|sd카드|방열판|쿨러|heatsink|cooler/i,
      ssd: /외장\s*케이스|클로저|컨버터|어댑터|가이드|방열판|enclosure|adapter|converter|heatsink/i,
      power: /케이블|연장|커넥터|cable|connector/i,
      case: /라이저|받침대|먼지\s*필터|riser|stand|filter/i,
      motherboard: /io\s*shield|back\s*panel|wifi\s*antenna|sata\s*cable|extension|브라켓|백패널|안테나|케이블/i,
      cooler: /thermal\s*paste|써멀|bracket|mount|mounting|fan\s*clip|클립|브라켓|가이드/i,
    };

    return patterns[componentType].test(haystack);
  }

  private async readResponseText(response: Response) {
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') ?? '';
    const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();

    if (charset && /euc-kr|ks_c_5601|cp949|windows-949/i.test(charset)) {
      return new TextDecoder('euc-kr').decode(buffer);
    }

    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if ((utf8.match(/\uFFFD/g) ?? []).length >= 3) {
      return new TextDecoder('euc-kr').decode(buffer);
    }

    return utf8;
  }

  private parsePrice(rawPrice: string | undefined) {
    if (!rawPrice) {
      return null;
    }

    const decoded = this.decodeHtml(rawPrice);
    const number = Number(decoded.replace(/[^\d]/g, ''));
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  private cleanHtml(value: string) {
    return this.decodeHtml(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  private encodeForCompuzone(query: string) {
    return encodeURIComponent(query.trim().replace(/\s+/g, ' ')).replace(/%20/g, '+');
  }
}
