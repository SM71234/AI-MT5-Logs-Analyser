import { Injectable } from '@nestjs/common';
import { NormalizationEngine, NormalizedEvent } from './normalization.engine';
import { CorrelationEngine, CorrelatedIncident } from './correlation.engine';

@Injectable()
export class JournalEngineService {
  constructor(
    private readonly normalizationEngine: NormalizationEngine,
    private readonly correlationEngine: CorrelationEngine,
  ) {}

  processLogs(rawLogs: string[]): CorrelatedIncident[] {
    const normalized: NormalizedEvent[] = [];
    for (const log of rawLogs) {
      const event = this.normalizationEngine.normalize(log);
      if (event) {
        normalized.push(event);
      }
    }
    return this.correlationEngine.correlate(normalized);
  }
}
