import { Module } from '@nestjs/common';
import { HospitalCacheService } from './hospital-cache.service';
import { HospitalClientService } from './hospital-client.service';
import { HospitalController } from './hospital.controller';

@Module({
  controllers: [HospitalController],
  providers: [HospitalCacheService, HospitalClientService],
})
export class HospitalModule {}
