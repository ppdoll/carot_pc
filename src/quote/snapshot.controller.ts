import { Controller, Get, Query, Render } from '@nestjs/common';
import { QuoteSnapshot, SnapshotStoreService } from './snapshot-store.service';

interface SnapshotQuery {
  cpu?: string;
  ram?: string;
  gpu?: string;
}

@Controller('daangn/snapshots')
export class SnapshotController {
  constructor(private readonly store: SnapshotStoreService) {}

  @Get()
  @Render('snapshots')
  async list(@Query() query: SnapshotQuery) {
    const filter = {
      cpu: query.cpu?.trim() || null,
      ram: query.ram?.trim() || null,
      gpu: query.gpu?.trim() || null,
    };

    const [snapshots, distinct] = await Promise.all([
      this.store.list(filter),
      this.store.distinctKeys(),
    ]);

    return {
      filter,
      hasFilter: Boolean(filter.cpu || filter.ram || filter.gpu),
      distinct,
      snapshots: snapshots.map((snapshot) => this.toRow(snapshot)),
      totalCount: snapshots.length,
    };
  }

  private toRow(snapshot: QuoteSnapshot) {
    const capturedAt = new Date(snapshot.capturedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const lastSeenAt = new Date(snapshot.lastSeenAt || snapshot.capturedAt).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
    });
    const priceHistory = this.toPriceHistory(snapshot);

    return {
      id: snapshot.id,
      capturedAt,
      lastSeenAt,
      sourceUrl: snapshot.sourceUrl,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      listingPrice: snapshot.listingPrice,
      priceHistory,
      hasPriceHistory: priceHistory.length > 1,
      keys: snapshot.keys,
      components: snapshot.components.map((component) => ({
        label: component.label,
        rawValue: component.rawValue ?? '-',
        searchQuery: component.searchQuery ?? '-',
        compuzonePrice: component.compuzonePrice,
        bunjangAverage: component.bunjang?.averagePrice ?? null,
        bunjangCount: component.bunjang?.sampleCount ?? 0,
        bunjangSearchUrl: component.bunjang?.searchUrl ?? null,
        joongnaAverage: component.joongna?.averagePrice ?? null,
        joongnaCount: component.joongna?.sampleCount ?? 0,
        joongnaSearchUrl: component.joongna?.searchUrl ?? null,
      })),
    };
  }

  private toPriceHistory(snapshot: QuoteSnapshot) {
    const history = snapshot.priceHistory?.length
      ? snapshot.priceHistory
      : [{ capturedAt: snapshot.capturedAt, listingPrice: snapshot.listingPrice }];

    return history.map((entry, index) => {
      const previous = index > 0 ? history[index - 1] : null;
      const delta =
        previous?.listingPrice != null && entry.listingPrice != null
          ? entry.listingPrice - previous.listingPrice
          : null;

      return {
        capturedAt: new Date(entry.capturedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        listingPrice: entry.listingPrice,
        delta,
      };
    });
  }
}
