import { UsedMarketSummary } from './used-market';

export const componentTypes = ['cpu', 'gpu', 'ram', 'ssd', 'power', 'case'] as const;

export type ComponentType = (typeof componentTypes)[number];

export interface ListingInfo {
  sourceUrl: string;
  finalUrl: string;
  title: string;
  description: string;
  price: number | null;
  imageUrl?: string;
  articleId?: string;
}

export interface ExtractedComponent {
  type: ComponentType;
  label: string;
  rawValue: string | null;
  searchQuery: string | null;
  detected: boolean;
  confidence: 'high' | 'medium' | 'low';
  sourceLine?: string;
}

export interface CompuzoneProduct {
  productNo: string;
  name: string;
  summary: string;
  price: number | null;
  priceText: string;
  url: string;
  imageUrl?: string;
  score: number;
}

export interface BenchmarkInfo {
  provider: 'PassMark';
  url: string;
  name: string | null;
  rank: number | null;
  rankTotal: number | null;
  rankText: string | null;
  score: number | null;
  scoreLabel: string;
  category: string | null;
  samples: number | null;
  status: 'ok' | 'not_found' | 'error';
}

export interface ComponentPriceEstimate {
  component: ExtractedComponent;
  status: 'skipped' | 'ok' | 'not_found' | 'error';
  searchUrl?: string;
  danawaSearchUrl?: string;
  naverSearchUrl?: string;
  benchmark?: BenchmarkInfo;
  selectedProduct?: CompuzoneProduct;
  products: CompuzoneProduct[];
  usedMarket?: {
    bunjang: UsedMarketSummary;
    joongna: UsedMarketSummary;
  };
  error?: string;
}

export interface PcQuoteAnalysis {
  listing: ListingInfo;
  components: ComponentPriceEstimate[];
  totals: {
    listingPrice: number | null;
    compuzoneComparableTotal: number;
    pricedComponentCount: number;
    detectedComponentCount: number;
    priceGap: number | null;
  };
  analyzedAt: string;
}
