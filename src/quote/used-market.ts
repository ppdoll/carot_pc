export type UsedMarketSource = 'bunjang' | 'joongna';

export interface UsedMarketSample {
  name: string;
  price: number;
  url: string;
  imageUrl?: string;
}

export interface UsedMarketSummary {
  source: UsedMarketSource;
  searchUrl: string;
  samples: UsedMarketSample[];
  averagePrice: number | null;
  sampleCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  error?: string;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s/\-()[\],]+/)
    .filter((token) => token.length >= 2);
}

export function matchesQueryTokens(name: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }

  const haystack = name.toLowerCase();
  const requiredHits = Math.max(1, Math.ceil(tokens.length / 2));
  let hits = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) {
      hits += 1;
    } else if (/\d/.test(token)) {
      return false;
    }
  }

  return hits >= requiredHits;
}

export function trimmedMean(prices: number[]): number | null {
  const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (valid.length === 0) {
    return null;
  }

  if (valid.length <= 3) {
    return Math.round(valid.reduce((sum, price) => sum + price, 0) / valid.length);
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const trim = Math.floor(valid.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return Math.round(trimmed.reduce((sum, price) => sum + price, 0) / trimmed.length);
}

export function summarizeSamples(
  source: UsedMarketSource,
  searchUrl: string,
  samples: UsedMarketSample[],
): UsedMarketSummary {
  const prices = samples.map((sample) => sample.price);
  const averagePrice = trimmedMean(prices);
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;

  return {
    source,
    searchUrl,
    samples,
    averagePrice,
    sampleCount: samples.length,
    minPrice,
    maxPrice,
  };
}

export function emptySummary(
  source: UsedMarketSource,
  searchUrl: string,
  error?: string,
): UsedMarketSummary {
  return {
    source,
    searchUrl,
    samples: [],
    averagePrice: null,
    sampleCount: 0,
    minPrice: null,
    maxPrice: null,
    error,
  };
}
