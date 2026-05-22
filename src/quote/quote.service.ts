import { Injectable } from '@nestjs/common';
import { ensurePostgresSchema, getPostgresPool, hasPostgresConfig } from '../database/postgres';
import { BenchmarkClientService } from './benchmark-client.service';
import { BunjangClientService } from './bunjang-client.service';
import { canonicalCpu, canonicalGpu, canonicalRam, ComponentKeys } from './component-key';
import { ComponentExtractorService } from './component-extractor.service';
import { CompuzoneClientService } from './compuzone-client.service';
import { DaangnClientService } from './daangn-client.service';
import { DanawaClientService } from './danawa-client.service';
import { JoongnaClientService } from './joongna-client.service';
import { SnapshotStoreService } from './snapshot-store.service';
import { ComponentPriceEstimate, ExtractedComponent, ListingInfo, PcQuoteAnalysis } from './types';

export const ANALYSIS_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface CachedAnalysis {
  analysis: PcQuoteAnalysis;
  capturedAt: Date;
  fromCache: boolean;
}


@Injectable()
export class QuoteService {
  constructor(
    private readonly daangnClient: DaangnClientService,
    private readonly componentExtractor: ComponentExtractorService,
    private readonly benchmarkClient: BenchmarkClientService,
    private readonly compuzoneClient: CompuzoneClientService,
    private readonly bunjangClient: BunjangClientService,
    private readonly joongnaClient: JoongnaClientService,
    private readonly danawaClient: DanawaClientService,
    private readonly snapshotStore: SnapshotStoreService,
  ) {}

  async analyzeUrl(sourceUrl: string): Promise<PcQuoteAnalysis> {
    const listing = await this.daangnClient.fetchListing(sourceUrl);
    return this.runAnalysis(listing, { saveSnapshot: true });
  }

  async analyzeText(text: string): Promise<PcQuoteAnalysis> {
    const listing: ListingInfo = {
      sourceUrl: '',
      finalUrl: '',
      title: '직접 입력한 스펙',
      description: text,
      price: null,
    };
    return this.runAnalysis(listing, { saveSnapshot: false });
  }

  private async runAnalysis(
    listing: ListingInfo,
    options: { saveSnapshot: boolean },
  ): Promise<PcQuoteAnalysis> {
    const components = this.componentExtractor.extract(listing.description);

    const estimates = await Promise.all(
      components.map(async (component): Promise<ComponentPriceEstimate> => {
        if (!component.detected || !component.searchQuery) {
          return {
            component,
            status: 'skipped',
            products: [],
          };
        }

        const searchUrl = this.compuzoneClient.buildSearchPageUrl(component.searchQuery);
        const danawaSearchUrl = this.buildDanawaSearchUrl(component.searchQuery);
        const naverSearchUrl = this.buildNaverSearchUrl(component.searchQuery);

        const [compuzoneResult, bunjangSummary, joongnaSummary, benchmark, danawaSummary] = await Promise.all([
          this.compuzoneClient
            .searchProducts(component.type, component.searchQuery)
            .then((products) => ({ products, error: null as Error | null }))
            .catch((error: unknown) => ({
              products: [] as Awaited<ReturnType<CompuzoneClientService['searchProducts']>>,
              error: error instanceof Error ? error : new Error('컴퓨존 검색 중 오류가 발생했습니다.'),
            })),
          this.bunjangClient.fetchSummary(component.searchQuery),
          this.joongnaClient.fetchSummary(component.searchQuery),
          this.benchmarkClient.fetchBenchmark(component.type, component.rawValue),
          this.danawaClient
            .fetchSummary(component.type, component.searchQuery)
            .catch(() => ({ searchUrl: danawaSearchUrl, samples: [], averagePrice: null, sampleCount: 0 })),
        ]);

        const usedMarket = { bunjang: bunjangSummary, joongna: joongnaSummary };
        const danawa = {
          searchUrl: danawaSummary.searchUrl,
          averagePrice: danawaSummary.averagePrice,
          sampleCount: danawaSummary.sampleCount,
        };

        if (compuzoneResult.error) {
          return {
            component,
            searchUrl,
            danawaSearchUrl,
            naverSearchUrl,
            status: 'error',
            products: [],
            usedMarket,
            danawa,
            benchmark,
            error: compuzoneResult.error.message,
          };
        }

        const representative = this.pickRepresentative(compuzoneResult.products);
        const selectedProduct = representative?.product;
        const compuzone = representative && representative.averagedSampleCount > 1
          ? {
              searchUrl,
              averagePrice: selectedProduct?.price ?? null,
              sampleCount: representative.averagedSampleCount,
            }
          : undefined;

        return {
          component,
          searchUrl,
          danawaSearchUrl,
          naverSearchUrl,
          status: selectedProduct ? 'ok' : 'not_found',
          selectedProduct,
          products: compuzoneResult.products,
          usedMarket,
          compuzone,
          danawa,
          benchmark,
        };
      }),
    );

    const compuzoneComparableTotal = estimates.reduce((sum, estimate) => {
      const price = estimate.selectedProduct?.price ?? estimate.danawa?.averagePrice ?? null;
      if (!price) return sum;
      return sum + price * estimate.component.quantity;
    }, 0);
    const pricedComponentCount = estimates.filter(
      (estimate) => Boolean(estimate.selectedProduct?.price ?? estimate.danawa?.averagePrice),
    ).length;
    const detectedComponentCount = components.filter((component) => component.detected).length;
    const priceGap = listing.price == null ? null : listing.price - compuzoneComparableTotal;

    const analysis: PcQuoteAnalysis = {
      listing,
      components: estimates,
      totals: {
        listingPrice: listing.price,
        compuzoneComparableTotal,
        pricedComponentCount,
        detectedComponentCount,
        priceGap,
      },
      analyzedAt: new Date().toISOString(),
    };

    if (options.saveSnapshot) {
      const keys = this.deriveKeys(components);
      if (keys.cpuKey || keys.ramKey || keys.gpuKey) {
        const snapshot = SnapshotStoreService.fromAnalysis(analysis, keys);
        this.snapshotStore.save(snapshot).catch(() => undefined);
      }
    }

    return analysis;
  }

  private pickRepresentative<T extends { price: number | null }>(
    products: T[],
  ): { product: T; averagedSampleCount: number } | undefined {
    if (products.length === 0) {
      return undefined;
    }

    const pricedProducts = products.filter(
      (product): product is T & { price: number } => typeof product.price === 'number' && product.price > 0,
    );

    if (pricedProducts.length < 2) {
      return { product: products[0], averagedSampleCount: 0 };
    }

    const average = Math.round(
      pricedProducts.reduce((sum, product) => sum + product.price, 0) / pricedProducts.length,
    );
    let closest = pricedProducts[0];
    let smallestDiff = Math.abs(closest.price - average);
    for (const product of pricedProducts.slice(1)) {
      const diff = Math.abs(product.price - average);
      const tiebreakerPrefersCheaper = diff === smallestDiff && product.price < closest.price;
      if (diff < smallestDiff || tiebreakerPrefersCheaper) {
        smallestDiff = diff;
        closest = product;
      }
    }
    return {
      product: { ...closest, price: average },
      averagedSampleCount: pricedProducts.length,
    };
  }

  private deriveKeys(components: ExtractedComponent[]): ComponentKeys {
    const find = (type: string) => components.find((component) => component.type === type)?.rawValue ?? null;
    return {
      cpuKey: canonicalCpu(find('cpu')),
      ramKey: canonicalRam(find('ram')),
      gpuKey: canonicalGpu(find('gpu')),
    };
  }

  async analyzeUrlCached(sourceUrl: string): Promise<CachedAnalysis> {
    const cached = await this.loadCachedAnalysis(sourceUrl);
    if (cached && Date.now() - cached.capturedAt.getTime() < ANALYSIS_CACHE_TTL_SECONDS * 1000) {
      return { ...cached, fromCache: true };
    }

    const analysis = await this.analyzeUrl(sourceUrl);
    const capturedAt = new Date(analysis.analyzedAt);
    await this.storeCachedAnalysis(sourceUrl, analysis, capturedAt).catch(() => undefined);
    return { analysis, capturedAt, fromCache: false };
  }

  private async loadCachedAnalysis(
    sourceUrl: string,
  ): Promise<{ analysis: PcQuoteAnalysis; capturedAt: Date } | null> {
    if (!hasPostgresConfig()) {
      return null;
    }
    await ensurePostgresSchema();
    const pool = getPostgresPool();
    const result = await pool.query<{ analysis: PcQuoteAnalysis; captured_at: Date }>(
      'SELECT analysis, captured_at FROM quote_analysis_cache WHERE source_url = $1',
      [sourceUrl],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (this.needsBenchmarkRefresh(row.analysis)) {
      return null;
    }
    return { analysis: row.analysis, capturedAt: new Date(row.captured_at) };
  }

  private needsBenchmarkRefresh(analysis: PcQuoteAnalysis): boolean {
    return analysis.components.some(
      (estimate) =>
        (estimate.component.type === 'cpu' || estimate.component.type === 'gpu') &&
        estimate.component.detected &&
        !estimate.benchmark,
    );
  }

  private async storeCachedAnalysis(
    sourceUrl: string,
    analysis: PcQuoteAnalysis,
    capturedAt: Date,
  ): Promise<void> {
    if (!hasPostgresConfig()) {
      return;
    }
    await ensurePostgresSchema();
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO quote_analysis_cache (source_url, analysis, captured_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_url) DO UPDATE
         SET analysis = EXCLUDED.analysis,
             captured_at = EXCLUDED.captured_at`,
      [sourceUrl, analysis, capturedAt.toISOString()],
    );
  }

  private buildDanawaSearchUrl(query: string) {
    const params = new URLSearchParams({ query: query.trim().replace(/\s+/g, ' ') });
    return `https://search.danawa.com/dsearch.php?${params.toString()}`;
  }

  private buildNaverSearchUrl(query: string) {
    const params = new URLSearchParams({ query: query.trim().replace(/\s+/g, ' ') });
    return `https://search.shopping.naver.com/search/all?${params.toString()}`;
  }
}
