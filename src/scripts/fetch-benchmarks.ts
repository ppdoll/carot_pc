import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type BenchmarkKind = 'cpu' | 'gpu';

interface BenchmarkEntry {
  rank: number;
  name: string;
  score: number | null;
  relativeScore: number | null;
  priceUsd: string | null;
  url: string;
  sourcePage: string;
}

interface BenchmarkSnapshot {
  kind: BenchmarkKind;
  source: 'PassMark';
  chart: string;
  capturedAt: string;
  updatedAtText: string | null;
  itemCount: number;
  items: BenchmarkEntry[];
}

interface SourceConfig {
  kind: BenchmarkKind;
  chart: string;
  urls: string[];
  fallbackHtmlFiles: string[];
  outputFile: string;
  minimumExpectedItems: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    kind: 'cpu',
    chart: 'high_end_multithread',
    urls: [
      'https://www.cpubenchmark.net/high_end_cpus.html',
      'https://www.cpubenchmark.net/multithread/page2',
      'https://www.cpubenchmark.net/multithread/page3',
      'https://www.cpubenchmark.net/multithread/page4',
    ],
    fallbackHtmlFiles: ['passmark-cpu-test.html'],
    outputFile: join('data', 'benchmarks', 'cpu-high-end.json'),
    minimumExpectedItems: 1000,
  },
  {
    kind: 'gpu',
    chart: 'high_end',
    urls: ['https://www.videocardbenchmark.net/high_end_gpus.html'],
    fallbackHtmlFiles: ['passmark-gpu-test.html'],
    outputFile: join('data', 'benchmarks', 'gpu-high-end.json'),
    minimumExpectedItems: 500,
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = SOURCE_CONFIGS.filter((config) => args.sources.has(config.kind));

  if (!selected.length) {
    throw new Error('No benchmark source selected.');
  }

  for (const config of selected) {
    const snapshot = await fetchSnapshot(config, args.mode, args.limit);
    if (snapshot.itemCount < Math.min(config.minimumExpectedItems, args.limit ?? Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Fetched only ${snapshot.itemCount} ${config.kind.toUpperCase()} rows; expected at least ${Math.min(config.minimumExpectedItems, args.limit ?? Number.MAX_SAFE_INTEGER)}.`,
      );
    }
    const outputPath = resolve(process.cwd(), config.outputFile);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${snapshot.itemCount} ${config.kind.toUpperCase()} rows to ${outputPath}`);
  }
}

async function fetchSnapshot(config: SourceConfig, mode: 'live' | 'local', limit: number | null): Promise<BenchmarkSnapshot> {
  const pages = mode === 'local' ? await readLocalPages(config) : await downloadPages(config);
  const allItems: BenchmarkEntry[] = [];
  let updatedAtText: string | null = null;

  for (const page of pages) {
    updatedAtText ??= extractUpdatedAtText(page.html);
    allItems.push(...parseEntries(page.html, page.sourcePage));
  }

  const items = dedupeByName(allItems)
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, limit ?? undefined);

  return {
    kind: config.kind,
    source: 'PassMark',
    chart: config.chart,
    capturedAt: new Date().toISOString(),
    updatedAtText,
    itemCount: items.length,
    items,
  };
}

async function downloadPages(config: SourceConfig) {
  const pages: Array<{ sourcePage: string; html: string }> = [];

  for (const url of config.urls) {
    const response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    pages.push({ sourcePage: url, html: await response.text() });
  }

  return pages;
}

async function readLocalPages(config: SourceConfig) {
  const pages: Array<{ sourcePage: string; html: string }> = [];

  for (const file of config.fallbackHtmlFiles) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) {
      throw new Error(`Local HTML file not found: ${path}`);
    }

    pages.push({
      sourcePage: file,
      html: await readFile(path, 'utf-8'),
    });
  }

  return pages;
}

function parseEntries(html: string, sourcePage: string): BenchmarkEntry[] {
  const entries: BenchmarkEntry[] = [];
  const pattern =
    /<li id="rk\d+"[\s\S]*?<a href="([^"]+)"[\s\S]*?<span class="prdname"\s*>([^<]+)<\/span>[\s\S]*?<span class="count">([\d,]+)<\/span>(?:[\s\S]*?<span class="price-neww">([^<]*)<\/span>)?[\s\S]*?<\/a>\s*<\/li>/g;

  for (const match of html.matchAll(pattern)) {
    const href = match[1] ?? '';
    const name = decodeHtml(match[2] ?? '').trim();
    const score = parseNumber(match[3] ?? null);
    const priceUsd = cleanText(match[4] ?? null);
    const relativeScore = parseRelativeScore(match[0]);

    if (!name) {
      continue;
    }

    entries.push({
      rank: 0,
      name,
      score,
      relativeScore,
      priceUsd,
      url: toAbsoluteUrl(href),
      sourcePage,
    });
  }

  return entries;
}

function extractUpdatedAtText(html: string): string | null {
  const match = html.match(/Updated\s+(\d{1,2}(?:st|nd|rd|th)\s+of\s+[A-Za-z]+\s+\d{4})/i);
  return match?.[1] ?? null;
}

function parseRelativeScore(htmlChunk: string): number | null {
  const match = htmlChunk.match(/<span class="index[^"]*"[^>]*>\((\d+)%\)<\/span>/i);
  return match ? Number(match[1]) : null;
}

function parseArgs(argv: string[]) {
  let mode: 'live' | 'local' = 'live';
  let limit: number | null = null;
  let sources = new Set<BenchmarkKind>(['cpu', 'gpu']);

  for (const arg of argv) {
    if (arg === '--local') {
      mode = 'local';
      continue;
    }

    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length).trim().toLowerCase();
      if (value === 'cpu' || value === 'gpu') {
        sources = new Set([value]);
      } else if (value === 'all') {
        sources = new Set(['cpu', 'gpu']);
      } else {
        throw new Error(`Unsupported source: ${value}`);
      }
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid limit: ${arg}`);
      }
      limit = Math.floor(value);
      continue;
    }
  }

  return { mode, limit, sources };
}

function dedupeByName(items: BenchmarkEntry[]) {
  const seen = new Set<string>();
  const deduped: BenchmarkEntry[] = [];

  for (const item of items) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function toAbsoluteUrl(href: string) {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  if (href.startsWith('gpu.php')) {
    return `https://www.videocardbenchmark.net/${decodeHtml(href)}`;
  }

  return `https://www.cpubenchmark.net/${decodeHtml(href).replace(/^\//, '')}`;
}

function parseNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const numeric = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanText(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = decodeHtml(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
