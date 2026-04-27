import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { QuoteModule } from './quote/quote.module';

@Module({
  imports: [QuoteModule],
  controllers: [AppController],
})
export class AppModule {}
