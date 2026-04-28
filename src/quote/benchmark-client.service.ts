import { Injectable } from '@nestjs/common';
import { BenchmarkStoreService } from './benchmark-store.service';
import { BenchmarkInfo, ComponentType } from './types';

@Injectable()
export class BenchmarkClientService {
  constructor(private readonly benchmarkStore: BenchmarkStoreService) {}

  async fetchBenchmark(componentType: ComponentType, rawValue: string | null): Promise<BenchmarkInfo | undefined> {
    if (componentType !== 'cpu' && componentType !== 'gpu') {
      return undefined;
    }

    const match = await this.benchmarkStore.find(componentType, rawValue);
    if (!match) {
      return undefined;
    }

    return {
      provider: match.source,
      url: match.item.url,
      name: match.item.name,
      rank: match.item.rank,
      rankTotal: match.itemCount,
      rankText: match.updatedAtText ? `High End rank as of ${match.updatedAtText}` : null,
      score: match.item.score,
      scoreLabel: componentType === 'cpu' ? 'CPU Mark' : 'G3D Mark',
      category: null,
      samples: null,
      status: 'ok',
    };
  }
}
