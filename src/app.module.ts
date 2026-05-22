import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HospitalModule } from './hospital/hospital.module';
import { QuoteModule } from './quote/quote.module';

@Module({
  imports: [QuoteModule, HospitalModule],
  controllers: [AppController],
})
export class AppModule {}
