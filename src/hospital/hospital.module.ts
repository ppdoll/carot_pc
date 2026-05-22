import { Module } from '@nestjs/common';
import { HospitalClientService } from './hospital-client.service';
import { HospitalController } from './hospital.controller';

@Module({
  controllers: [HospitalController],
  providers: [HospitalClientService],
})
export class HospitalModule {}
