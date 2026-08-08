import { Module } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { InvestigationsController } from './investigations.controller';
import { Mt5Module } from '../mt5/mt5.module';
import { JournalModule } from '../journal/journal.module';
import { MetricsModule } from '../metrics/metrics.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [Mt5Module, JournalModule, MetricsModule, AiModule],
  providers: [InvestigationsService],
  controllers: [InvestigationsController],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
