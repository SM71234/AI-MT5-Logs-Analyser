import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { Mt5Module } from '../mt5/mt5.module';
import { MetricsModule } from '../metrics/metrics.module';
import { NormalizationEngine } from './normalization.engine';
import { CorrelationEngine } from './correlation.engine';
import { JournalEngineService } from './journal-engine.service';

@Module({
  imports: [Mt5Module, MetricsModule],
  providers: [NormalizationEngine, CorrelationEngine, JournalEngineService],
  controllers: [JournalController],
  exports: [NormalizationEngine, CorrelationEngine, JournalEngineService],
})
export class JournalModule {}
