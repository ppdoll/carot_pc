import { BadRequestException, Body, Controller, Get, Post, Query, Render, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  isPriceVoteKind,
  PriceVoteKind,
  PriceVoteStoreService,
  PriceVoteSummary,
} from './price-vote-store.service';
import { hasPreciseUsedMarketModel } from './price-model-precision';
import { ANALYSIS_CACHE_TTL_SECONDS, QuoteService } from './quote.service';
import { ComponentPriceEstimate, PcQuoteAnalysis } from './types';

interface AnalyzeBody {
  url?: string;
}

interface PriceVoteBody {
  targetId?: string;
  vote?: string;
  sourceUrl?: string;
  finalUrl?: string;
  title?: string;
}

interface RequestLike {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string | null;
  };
}

interface PriceEvaluation {
  standardPrice: number | null;
  basisText: string;
  formulaText: string;
  breakdownRows: PriceEvaluationBreakdownRow[];
}

interface PriceEvaluationBreakdownRow {
  label: string;
  rawValue: string;
  searchQuery: string;
  bunjangAverage: number | null;
  bunjangCount: number;
  bunjangSearchUrl: string | null;
  joongnaAverage: number | null;
  joongnaCount: number;
  joongnaSearchUrl: string | null;
  compuzonePrice: number | null;
  componentStandard: number | null;
  included: boolean;
  includedText: string;
  basisText: string;
}

interface ShareInfo {
  cacheTtlHours: number;
  cachedAtText: string;
  cachedUntilText: string;
}

interface StandardPriceResult {
  price: number | null;
  basisText: string;
  formulaText: string;
  breakdownRows: PriceEvaluationBreakdownRow[];
}

@Controller()
export class QuoteController {
  constructor(
    private readonly quoteService: QuoteService,
    private readonly voteStore: PriceVoteStoreService,
  ) {}

  @Get('daangn/quotes')
  @Render('quote-form')
  form() {
    return {
      url: '',
      exampleUrl: 'https://www.daangn.com/articles/1156255068',
    };
  }

  @Get('daangn/quotes/analyze')
  @Render('quote-result')
  async analyzeForGet(
    @Query('url') urlParam: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const url = String(urlParam ?? '').trim();

    if (!url) {
      response.setHeader('Cache-Control', 'no-store');
      return {
        error: '당근 판매글 URL을 입력해 주세요.',
        url,
      };
    }

    try {
      const { analysis, capturedAt } = await this.quoteService.analyzeUrlCached(url);
      const voteTarget = this.voteTarget(analysis);
      const voteSummary = await this.voteStore.summary(voteTarget.targetId);

      response.setHeader(
        'Cache-Control',
        `public, s-maxage=${ANALYSIS_CACHE_TTL_SECONDS}, stale-while-revalidate=${ANALYSIS_CACHE_TTL_SECONDS * 7}`,
      );

      return this.toViewModel(analysis, voteSummary, this.buildShareInfo(capturedAt));
    } catch (error) {
      response.setHeader('Cache-Control', 'no-store');
      return {
        error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.',
        url,
      };
    }
  }

  @Post('daangn/quotes/analyze')
  @Render('quote-result')
  async analyzeForAdmin(@Body() body: AnalyzeBody, @Req() request: RequestLike) {
    const url = String(body.url ?? '').trim();

    if (!url) {
      return {
        error: '당근 판매글 URL을 입력해 주세요.',
        url,
      };
    }

    try {
      const analysis = await this.quoteService.analyzeUrl(url);
      const voteTarget = this.voteTarget(analysis);
      const voteSummary = await this.voteStore.summary(voteTarget.targetId, this.clientIp(request));
      return this.toViewModel(analysis, voteSummary);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '분석 중 오류가 발생했습니다.',
        url,
      };
    }
  }

  @Post('api/quotes/analyze')
  async analyzeForApi(@Body() body: AnalyzeBody) {
    const url = String(body.url ?? '').trim();
    if (!url) {
      throw new BadRequestException('url is required');
    }

    return this.quoteService.analyzeUrl(url);
  }

  @Post('api/quotes/price-votes')
  async voteForApi(@Body() body: PriceVoteBody, @Req() request: RequestLike) {
    const targetId = String(body.targetId ?? '').trim();
    if (!targetId) {
      throw new BadRequestException('targetId is required');
    }

    if (!isPriceVoteKind(body.vote)) {
      throw new BadRequestException('vote must be great, fair, or expensive');
    }

    return this.voteStore.vote({
      targetId,
      vote: body.vote,
      clientIp: this.clientIp(request),
      sourceUrl: stringOrNull(body.sourceUrl),
      finalUrl: stringOrNull(body.finalUrl),
      title: stringOrNull(body.title),
    });
  }

  private toViewModel(analysis: PcQuoteAnalysis, voteSummary: PriceVoteSummary, share?: ShareInfo) {
    const evaluation = this.priceEvaluation(analysis);
    const voteTarget = this.voteTarget(analysis);

    return {
      analysis,
      rows: analysis.components.map((estimate) => this.toRow(estimate)),
      analyzedAtText: new Date(analysis.analyzedAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
      }),
      hasPriceGap: analysis.totals.priceGap !== null,
      isBelowComparable:
        analysis.totals.priceGap !== null && analysis.totals.priceGap < 0 && analysis.totals.pricedComponentCount > 0,
      priceEvaluation: evaluation,
      priceVote: this.toVoteViewModel(voteTarget, voteSummary),
      share: share ?? null,
    };
  }

  private buildShareInfo(capturedAt: Date): ShareInfo {
    const cachedUntil = new Date(capturedAt.getTime() + ANALYSIS_CACHE_TTL_SECONDS * 1000);
    const formatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return {
      cacheTtlHours: Math.round(ANALYSIS_CACHE_TTL_SECONDS / 3600),
      cachedAtText: formatter.format(capturedAt),
      cachedUntilText: formatter.format(cachedUntil),
    };
  }

  private toRow(estimate: ComponentPriceEstimate) {
    const selected = estimate.selectedProduct;

    return {
      label: estimate.component.label,
      rawValue: estimate.component.rawValue ?? '-',
      searchQuery: estimate.component.searchQuery ?? '-',
      sourceLine: estimate.component.sourceLine,
      confidence: estimate.component.confidence,
      statusText: this.statusText(estimate),
      searchUrl: estimate.searchUrl,
      danawaSearchUrl: estimate.danawaSearchUrl,
      naverSearchUrl: estimate.naverSearchUrl,
      benchmark: estimate.benchmark
        ? {
            ...estimate.benchmark,
            rankDisplay: this.benchmarkRankDisplay(estimate.benchmark.rank, estimate.benchmark.rankTotal),
            scoreDisplay: this.benchmarkScoreDisplay(estimate.benchmark.score, estimate.benchmark.scoreLabel),
            samplesDisplay: this.benchmarkSamplesDisplay(estimate.benchmark.samples),
            hasDetails: estimate.benchmark.status === 'ok',
          }
        : null,
      benchmarkFallbackText: this.benchmarkFallbackText(estimate),
      showFallbackLinks: estimate.status !== 'ok',
      usedMarket: this.hasPreciseMarketModel(estimate) ? estimate.usedMarket : null,
      usedMarketNote:
        estimate.component.detected && !this.hasPreciseMarketModel(estimate)
          ? '모델명이 구체적이지 않아 중고 시세를 기준가에서 제외했습니다.'
          : null,
      selectedName: selected?.name ?? '-',
      selectedSummary: selected?.summary ?? '',
      selectedUrl: selected?.url,
      selectedPrice: selected?.price ?? null,
      products: estimate.products.slice(0, 3),
      error: estimate.error,
    };
  }

  private statusText(estimate: ComponentPriceEstimate) {
    if (estimate.status === 'skipped') {
      return '미검출';
    }

    if (estimate.status === 'not_found') {
      return '검색 결과 없음';
    }

    if (estimate.status === 'error') {
      return '검색 실패';
    }

    return '가격 확인';
  }

  private benchmarkRankDisplay(rank: number | null, total: number | null) {
    if (!rank) {
      return null;
    }
    return total ? `#${rank.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}` : `#${rank.toLocaleString('ko-KR')}`;
  }

  private benchmarkScoreDisplay(score: number | null, label: string) {
    if (!score) {
      return null;
    }
    return `${label} ${score.toLocaleString('ko-KR')}`;
  }

  private benchmarkSamplesDisplay(samples: number | null) {
    if (!samples) {
      return null;
    }
    return `${samples.toLocaleString('ko-KR')} samples`;
  }

  private benchmarkFallbackText(estimate: ComponentPriceEstimate) {
    if (estimate.component.type !== 'cpu' && estimate.component.type !== 'gpu') {
      return '- 집계하지 않습니다.';
    }

    return '1000위권 밖입니다';
  }

  private priceEvaluation(analysis: PcQuoteAnalysis): PriceEvaluation {
    const standard = this.standardPrice(analysis);
    return {
      standardPrice: standard.price,
      basisText: standard.basisText,
      formulaText: standard.formulaText,
      breakdownRows: standard.breakdownRows,
    };
  }

  private standardPrice(analysis: PcQuoteAnalysis): StandardPriceResult {
    const preciseEstimates = analysis.components.filter((estimate) => this.hasPreciseMarketModel(estimate));
    const usedMarketRows = preciseEstimates.map((estimate) => this.toUsedMarketBreakdownRow(estimate));
    const usedComponentPrices = usedMarketRows
      .map((row) => row.componentStandard)
      .filter((price): price is number => price !== null);

    if (usedComponentPrices.length > 0) {
      const price = usedComponentPrices.reduce((sum, value) => sum + value, 0);
      return {
        price,
        basisText: `중고 시세 ${usedComponentPrices.length}개 부품 기준`,
        formulaText:
          '참고 시세이며 정확한 감정가가 아닙니다. 구체 모델명이 있고 중고 평균가가 컴퓨존가 이하인 부품만 사용합니다.',
        breakdownRows: usedMarketRows.filter((row) => row.componentStandard !== null),
      };
    }

    const compuzoneRows = preciseEstimates.map((estimate) => this.toCompuzoneBreakdownRow(estimate));
    const compuzonePrices = compuzoneRows
      .map((row) => row.componentStandard)
      .filter((price): price is number => price !== null);

    if (compuzonePrices.length > 0) {
      return {
        price: compuzonePrices.reduce((sum, price) => sum + price, 0),
        basisText: `컴퓨존 ${compuzonePrices.length}개 부품 기준`,
        formulaText: '중고 시세가 없어서 구체 모델명이 있는 부품의 컴퓨존 대표 상품가만 합산했습니다.',
        breakdownRows: compuzoneRows.filter((row) => row.componentStandard !== null),
      };
    }

    return {
      price: null,
      basisText: '기준가 없음',
      formulaText:
        '구체 모델명이 있는 부품의 중고 시세와 컴퓨존 대표 상품가를 찾지 못해 기준가를 만들지 못했습니다.',
      breakdownRows: compuzoneRows,
    };
  }

  private hasPreciseMarketModel(estimate: ComponentPriceEstimate): boolean {
    return hasPreciseUsedMarketModel(estimate.component.type, estimate.component.rawValue);
  }

  private toUsedMarketBreakdownRow(estimate: ComponentPriceEstimate): PriceEvaluationBreakdownRow {
    const compuzonePrice = validPrice(estimate.selectedProduct?.price);
    const bunjangAverage = validPrice(estimate.usedMarket?.bunjang.averagePrice);
    const joongnaAverage = validPrice(estimate.usedMarket?.joongna.averagePrice);
    const usableBunjang = isUsableUsedPrice(bunjangAverage, compuzonePrice) ? bunjangAverage : null;
    const usableJoongna = isUsableUsedPrice(joongnaAverage, compuzonePrice) ? joongnaAverage : null;
    const prices = [usableBunjang, usableJoongna].filter((price): price is number => price !== null);
    const componentStandard =
      prices.length > 0 ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null;
    const hasAnyUsedAverage = bunjangAverage !== null || joongnaAverage !== null;
    const droppedAboveCompuzone =
      componentStandard === null && hasAnyUsedAverage && compuzonePrice !== null;

    return {
      label: estimate.component.label,
      rawValue: estimate.component.rawValue ?? '-',
      searchQuery: estimate.component.searchQuery ?? '-',
      bunjangAverage,
      bunjangCount: estimate.usedMarket?.bunjang.sampleCount ?? 0,
      bunjangSearchUrl: estimate.usedMarket?.bunjang.searchUrl ?? null,
      joongnaAverage,
      joongnaCount: estimate.usedMarket?.joongna.sampleCount ?? 0,
      joongnaSearchUrl: estimate.usedMarket?.joongna.searchUrl ?? null,
      compuzonePrice,
      componentStandard,
      included: componentStandard !== null,
      includedText: componentStandard !== null ? '포함' : '제외',
      basisText:
        componentStandard !== null
          ? `${prices.length}개 중고 시세 평균`
          : droppedAboveCompuzone
            ? '중고가가 컴퓨존가보다 높아 제외'
            : '중고 시세 없음',
    };
  }

  private toCompuzoneBreakdownRow(estimate: ComponentPriceEstimate): PriceEvaluationBreakdownRow {
    const compuzonePrice = validPrice(estimate.selectedProduct?.price);

    return {
      label: estimate.component.label,
      rawValue: estimate.component.rawValue ?? '-',
      searchQuery: estimate.component.searchQuery ?? '-',
      bunjangAverage: validPrice(estimate.usedMarket?.bunjang.averagePrice),
      bunjangCount: estimate.usedMarket?.bunjang.sampleCount ?? 0,
      bunjangSearchUrl: estimate.usedMarket?.bunjang.searchUrl ?? null,
      joongnaAverage: validPrice(estimate.usedMarket?.joongna.averagePrice),
      joongnaCount: estimate.usedMarket?.joongna.sampleCount ?? 0,
      joongnaSearchUrl: estimate.usedMarket?.joongna.searchUrl ?? null,
      compuzonePrice,
      componentStandard: compuzonePrice,
      included: compuzonePrice !== null,
      includedText: compuzonePrice !== null ? '포함' : '제외',
      basisText: compuzonePrice !== null ? '컴퓨존 대표 상품가' : '컴퓨존 가격 없음',
    };
  }

  private voteTarget(analysis: PcQuoteAnalysis) {
    const targetId = analysis.listing.articleId
      ? `daangn:${analysis.listing.articleId}`
      : `url:${analysis.listing.finalUrl}`;

    return {
      targetId,
      sourceUrl: analysis.listing.sourceUrl,
      finalUrl: analysis.listing.finalUrl,
      title: analysis.listing.title,
    };
  }

  private toVoteViewModel(
    target: { targetId: string; sourceUrl: string; finalUrl: string; title: string },
    summary: PriceVoteSummary,
  ) {
    const userVoteLabel = summary.userVote ? voteLabels[summary.userVote] : null;
    return {
      ...target,
      counts: summary.counts,
      total: summary.total,
      hasUserVote: Boolean(summary.userVote),
      userVote: summary.userVote,
      userVoteLabel,
      userVoteGreat: summary.userVote === 'great',
      userVoteFair: summary.userVote === 'fair',
      userVoteExpensive: summary.userVote === 'expensive',
    };
  }

  private clientIp(request: RequestLike): string {
    const forwarded = request.headers?.['x-forwarded-for'];
    if (Array.isArray(forwarded)) {
      return forwarded[0] ?? request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    }
    return forwarded ?? request.ip ?? request.socket?.remoteAddress ?? 'unknown';
  }
}

const voteLabels: Record<PriceVoteKind, string> = {
  great: 'best',
  fair: 'better',
  expensive: 'bad',
};

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 500) : null;
}

function validPrice(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

function isUsableUsedPrice(usedPrice: number | null, compuzonePrice: number | null): boolean {
  if (usedPrice === null) {
    return false;
  }
  if (compuzonePrice === null) {
    return true;
  }
  return usedPrice <= compuzonePrice;
}
