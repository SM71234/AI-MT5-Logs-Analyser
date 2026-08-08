import { Injectable, Logger } from '@nestjs/common';
import { CorrelatedIncident } from '../journal/correlation.engine';

export interface CalculatedMetrics {
  executionLatencyMs: number;
  dealerLatencyMs: number;
  slippagePips: number;
  priceDelta: number;
  requoteCount: number;
  retryCount: number;
  dealerId: string | null;
  hasRequote: boolean;
  isNormal: boolean;
  digits: number | null;
  pointSize: number | null;
  slippagePoints: number | null;
  slippageType: 'Adverse' | 'Favorable' | 'Zero';
  reason: string | null;
  priceRequested?: number;
  priceExecuted?: number;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger('MetricsService');

  calculate(
    incident: CorrelatedIncident,
    digits: number | null = null,
    point: number | null = null,
  ): CalculatedMetrics {
    const { events, symbol, action } = incident;

    // 1. Find key timestamps for latency checks
    const submitEvent = events.find((e) => e.eventType === 'ORDER_SUBMITTED');
    const routeEvent = events.find((e) => e.eventType === 'ORDER_ROUTED');
    const dealerAcceptEvent = events.find((e) => e.eventType === 'DEALER_ACCEPTED');
    const execEvent = events.find((e) => e.eventType === 'ORDER_EXECUTED');

    // Execution latency: total time between client click (submitted) and deal executed
    let executionLatencyMs = 0;
    if (submitEvent && execEvent) {
      executionLatencyMs =
        new Date(execEvent.timestamp).getTime() - new Date(submitEvent.timestamp).getTime();
    }

    // Dealer latency: time request spent waiting in manual dealer terminal queue
    let dealerLatencyMs = 0;
    if (routeEvent && dealerAcceptEvent) {
      dealerLatencyMs =
        new Date(dealerAcceptEvent.timestamp).getTime() - new Date(routeEvent.timestamp).getTime();
    }

    // 2. Calculate Slippage
    let priceDelta = 0;
    let slippagePoints: number | null = null;
    
    // Find initial request price (from submit) and final execution price (from executed)
    const initialPrice = submitEvent?.metadata?.priceRequested;
    const finalPrice = execEvent?.metadata?.priceExecuted;

    if (initialPrice && finalPrice) {
      priceDelta = finalPrice - initialPrice;

      const pointSize = point ?? (digits !== null ? Math.pow(10, -digits) : null);
      if (pointSize !== null && pointSize > 0) {
        slippagePoints = Math.abs(priceDelta) / pointSize;
      }
    }

    // Determine favorable / adverse / zero slippage
    // BUY: Executed > Requested -> Negative/Adverse, Executed < Requested -> Positive/Favorable
    // SELL: Executed < Requested -> Negative/Adverse, Executed > Requested -> Positive/Favorable
    let slippageType: 'Adverse' | 'Favorable' | 'Zero' = 'Zero';
    if (initialPrice && finalPrice) {
      const isBuy = action === 'BUY';
      if (Math.abs(priceDelta) < 1e-8) {
        slippageType = 'Zero';
      } else if (isBuy) {
        slippageType = priceDelta > 0 ? 'Adverse' : 'Favorable';
      } else {
        slippageType = priceDelta < 0 ? 'Adverse' : 'Favorable';
      }
    }

    // 3. Requote calculations
    const requoteEvents = events.filter((e) => e.eventType === 'DEALER_REQUOTED');
    const requoteCount = requoteEvents.length;
    const hasRequote = requoteCount > 0;

    // Retries count (how many times request was submitted due to requotes or server rejections)
    const submitCount = events.filter((e) => e.eventType === 'ORDER_SUBMITTED').length;
    const retryCount = Math.max(0, submitCount - 1);

    // Extract dealer identifier
    const dealerId = dealerAcceptEvent?.metadata?.dealerId || 
                     requoteEvents[0]?.metadata?.dealerId || 
                     null;

    // Categorize execution status: Normal if low latency, low slippage, and zero requotes
    const legacyPips = this.convertToPips(symbol, action === 'BUY' ? priceDelta : -priceDelta);
    const checkedSlippage = slippagePoints !== null ? slippagePoints : legacyPips;
    const isNormal = executionLatencyMs < 300 && checkedSlippage <= 1.0 && !hasRequote;

    return {
      executionLatencyMs,
      dealerLatencyMs,
      slippagePips: slippagePoints !== null ? parseFloat(slippagePoints.toFixed(1)) : parseFloat(legacyPips.toFixed(1)),
      priceDelta: parseFloat(priceDelta.toFixed(5)),
      requoteCount,
      retryCount,
      dealerId,
      hasRequote,
      isNormal,
      // New dynamic slippage analysis fields
      digits,
      pointSize: point ?? (digits !== null ? Math.pow(10, -digits) : null),
      slippagePoints: slippagePoints !== null ? parseFloat(slippagePoints.toFixed(1)) : null,
      slippageType,
      reason: digits === null ? 'Symbol Digits/Point Size not available' : null,
      priceRequested: initialPrice,
      priceExecuted: finalPrice,
    };
  }

  // Convert raw price changes to standard pips based on symbol characteristics
  private convertToPips(symbol: string, rawDelta: number): number {
    const symbolUpper = symbol.toUpperCase();

    // 1. JPY currency pairs (typically 3 decimal digits, 1 pip = 0.01)
    if (symbolUpper.includes('JPY')) {
      return rawDelta / 0.01;
    }

    // 2. Gold (XAUUSD, typically 2 decimal digits, 1 pip = 0.10)
    if (symbolUpper.includes('XAU') || symbolUpper.includes('GOLD')) {
      return rawDelta / 0.10;
    }

    // 3. Silver / other commodities (typically 1 pip = 0.01)
    if (symbolUpper.includes('XAG')) {
      return rawDelta / 0.01;
    }

    // 4. Major currency pairs (typically 5 decimal digits, 1 pip = 0.00010)
    return rawDelta / 0.0001;
  }
}
