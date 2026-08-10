import { Module } from '@nestjs/common';
import { Mt5Service } from './mt5.service';
import { BrokersModule } from '../brokers/brokers.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [BrokersModule, MetricsModule],
  providers: [Mt5Service],
  exports: [Mt5Service],
})
export class Mt5Module {}
