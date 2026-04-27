import { Module } from '@nestjs/common';
import { BunjangClientService } from './bunjang-client.service';
import { ComponentExtractorService } from './component-extractor.service';
import { CompuzoneClientService } from './compuzone-client.service';
import { DaangnClientService } from './daangn-client.service';
import { JoongnaClientService } from './joongna-client.service';
import { PriceVoteStoreService } from './price-vote-store.service';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { SnapshotController } from './snapshot.controller';
import { SnapshotStoreService } from './snapshot-store.service';

@Module({
  controllers: [QuoteController, SnapshotController],
  providers: [
    QuoteService,
    DaangnClientService,
    ComponentExtractorService,
    CompuzoneClientService,
    BunjangClientService,
    JoongnaClientService,
    PriceVoteStoreService,
    SnapshotStoreService,
  ],
})
export class QuoteModule {}
