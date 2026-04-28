import { Injectable } from '@nestjs/common';
import { ensurePostgresSchema, getPostgresPool, hasPostgresConfig } from '../database/postgres';
import { BenchmarkClientService } from './benchmark-client.service';
import { BunjangClientService } from './bunjang-client.service';
import { canonicalCpu, canonicalGpu, canonicalRam, ComponentKeys } from './component-key';
import { ComponentExtractorService } from './component-extractor.service';
import { CompuzoneClientService } from './compuzone-client.service';
import { DaangnClientService } from './daangn-client.service';
import { JoongnaClientService } from './joongna-client.service';
import { SnapshotStoreService } from './snapshot-store.service';
import { ComponentPriceEstimate, ExtractedComponent, PcQuoteAnalysis } from './types';

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
    private readonly snapshotStore: SnapshotStoreService,
  ) {}

  async analyzeUrl(sourceUrl: string): Promise<PcQuoteAnalysis> {
    const listing = await this.daangnClient.fetchListing(sourceUrl);
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

        const [compuzoneResult, bunjangSummary, joongnaSummary, benchmark] = await Promise.all([
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
        ]);

        const usedMarket = { bunjang: bunjangSummary, joongna: joongnaSummary };

        if (compuzoneResult.error) {
          return {
            component,
            searchUrl,
            danawaSearchUrl,
            naverSearchUrl,
            status: 'error',
            products: [],
            usedMarket,
            benchmark,
            error: compuzoneResult.error.message,
          };
        }

        const selectedProduct = compuzoneResult.products[0];

        return {
          component,
          searchUrl,
          danawaSearchUrl,
          naverSearchUrl,
          status: selectedProduct ? 'ok' : 'not_found',
          selectedProduct,
          products: compuzoneResult.products,
          usedMarket,
          benchmark,
        };
      }),
    );

    const pricedProducts = estimates
      .map((estimate) => estimate.selectedProduct)
      .filter((product): product is NonNullable<typeof product> => Boolean(product?.price));

    const compuzoneComparableTotal = pricedProducts.reduce((sum, product) => sum + Number(product.price), 0);
    const detectedComponentCount = components.filter((component) => component.detected).length;
    const priceGap = listing.price == null ? null : listing.price - compuzoneComparableTotal;

    const analysis: PcQuoteAnalysis = {
      listing,
      components: estimates,
      totals: {
        listingPrice: listing.price,
        compuzoneComparableTotal,
        pricedComponentCount: pricedProducts.length,
        detectedComponentCount,
        priceGap,
      },
      analyzedAt: new Date().toISOString(),
    };

    const keys = this.deriveKeys(components);
    if (keys.cpuKey || keys.ramKey || keys.gpuKey) {
      const snapshot = SnapshotStoreService.fromAnalysis(analysis, keys);
      this.snapshotStore.save(snapshot).catch(() => undefined);
    }

    return analysis;
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
