import { Injectable, Logger } from '@nestjs/common';
import { CorrelatedIncident } from '../journal/correlation.engine';

export interface CalculatedMetrics {
  executionLatencyMs: number | null;
  rejectionLatencyMs: number | null;
  dealerLatencyMs: number;
  slippagePips: number | null;
  priceDelta: number;
  requoteCount: number;
  retryCount: number;
  dealerId: string | null;
  hasRequote: boolean;
  isNormal: boolean;
  digits: number | null;
  pointSize: number | null;
  slippagePoints: number | null;
  slippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A';
  reason: string | null;
  priceRequested?: number;
  priceExecuted?: number | null;
  rejection?: {
    isRejected: boolean;
    reason: string | null;
    rawReason: string | null;
    rejectedBy: string | null;
    failedStage: string | null;
    lastSuccessfulStage: string | null;
  };
  status: 'EXECUTED' | 'REJECTED' | 'INCOMPLETE' | 'UNKNOWN' | 'PARTIAL';
  executed: boolean;
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
    const rejectEvent = events.find((e) => e.eventType === 'ORDER_REJECTED' || e.eventType === 'DEALER_REJECTED');

    const hasExecution = !!execEvent;
    const hasRejection = !!rejectEvent;

    // Strict status mapping
    let status: 'EXECUTED' | 'REJECTED' | 'INCOMPLETE' | 'UNKNOWN' = 'UNKNOWN';
    let executed = false;
    if (hasExecution) {
      status = 'EXECUTED';
      executed = true;
    } else if (hasRejection) {
      status = 'REJECTED';
      executed = false;
    } else if (submitEvent) {
      status = 'INCOMPLETE';
      executed = false;
    }

    // Execution latency: total time between client click (submitted) and deal executed
    let executionLatencyMs: number | null = null;
    if (submitEvent && execEvent) {
      executionLatencyMs =
        new Date(execEvent.timestamp).getTime() - new Date(submitEvent.timestamp).getTime();
      if (executionLatencyMs < 0) executionLatencyMs = 0;
    }

    // Rejection latency: time between client request and rejection event
    let rejectionLatencyMs: number | null = null;
    if (submitEvent && rejectEvent) {
      rejectionLatencyMs =
        new Date(rejectEvent.timestamp).getTime() - new Date(submitEvent.timestamp).getTime();
      if (rejectionLatencyMs < 0) rejectionLatencyMs = 0;
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
    let slippagePips: number | null = null;
    let slippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A' = 'N/A';
    
    // Find initial request price (from submit) and final execution price (from executed)
    const initialPrice = submitEvent?.metadata?.priceRequested;
    const finalPrice = execEvent?.metadata?.priceExecuted;

    if (hasExecution && initialPrice !== undefined && finalPrice !== undefined && initialPrice !== null && finalPrice !== null) {
      priceDelta = finalPrice - initialPrice;

      const pointSize = point ?? (digits !== null ? Math.pow(10, -digits) : null);
      if (pointSize !== null && pointSize > 0) {
        slippagePoints = Math.abs(priceDelta) / pointSize;
      }

      const isBuy = action === 'BUY';
      if (Math.abs(priceDelta) < 1e-8) {
        slippageType = 'Zero';
      } else if (isBuy) {
        slippageType = priceDelta > 0 ? 'Adverse' : 'Favorable';
      } else {
        slippageType = priceDelta < 0 ? 'Adverse' : 'Favorable';
      }

      const legacyPips = this.convertToPips(symbol, action === 'BUY' ? priceDelta : -priceDelta);
      slippagePips = slippagePoints !== null ? parseFloat(slippagePoints.toFixed(1)) : parseFloat(legacyPips.toFixed(1));
    } else {
      priceDelta = 0;
      slippagePoints = null;
      slippagePips = null;
      slippageType = 'N/A';
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
    const isNormal = executed && (executionLatencyMs !== null && executionLatencyMs < 300) && (slippagePips !== null && slippagePips <= 1.0) && !hasRequote;

    // Rejection analysis
    let rejection = undefined;
    if (hasRejection) {
      const rawReason = rejectEvent.metadata.rawReason || '';
      let reason = 'Unknown rejection reason';
      let rejectedBy = 'Unknown';
      let failedStage = 'Unknown';
      let lastSuccessfulStage = 'Unknown';

      if (rejectEvent.eventType === 'ORDER_REJECTED') {
        const lowerReason = rawReason.toLowerCase();
        if (lowerReason.includes('not enough money') || lowerReason.includes('margin')) {
          reason = 'Insufficient margin';
          rejectedBy = 'MT5 Server (Margin Validation)';
          failedStage = 'Server Validation';
          lastSuccessfulStage = 'Client Request';
        } else if (lowerReason.includes('market closed')) {
          reason = 'Market closed';
          rejectedBy = 'MT5 Server';
          failedStage = 'Server Validation';
          lastSuccessfulStage = 'Client Request';
        } else if (lowerReason.includes('invalid volume')) {
          reason = 'Invalid volume';
          rejectedBy = 'MT5 Server (Trading Rules)';
          failedStage = 'Server Validation';
          lastSuccessfulStage = 'Client Request';
        } else {
          reason = rawReason || 'Request rejected';
          rejectedBy = 'MT5 Server';
          failedStage = 'Server Validation';
          lastSuccessfulStage = 'Client Request';
        }
      } else if (rejectEvent.eventType === 'DEALER_REJECTED') {
        reason = 'Dealer rejection';
        rejectedBy = `Dealer #${rejectEvent.metadata.dealerId || 'Desk'}`;
        failedStage = 'Dealer Desk';
        
        const hasRoute = events.some(e => e.eventType === 'ORDER_ROUTED');
        lastSuccessfulStage = hasRoute ? 'Routing' : 'Server Validation';
      }

      rejection = {
        isRejected: true,
        reason,
        rawReason: rawReason || null,
        rejectedBy,
        failedStage,
        lastSuccessfulStage,
      };
    }

    return {
      executionLatencyMs,
      rejectionLatencyMs,
      dealerLatencyMs,
      slippagePips,
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
      priceExecuted: hasExecution ? finalPrice : null,
      rejection,
      status,
      executed,
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

  // Shared execution analysis method for Trade Explorer and Investigate views
  analyzeExecution(entry: any, exit: any): any {
    const entryExecution = entry ? {
      priceRequested: entry.priceRequested ?? null,
      priceExecuted: entry.priceExecuted ?? null,
      slippagePoints: entry.slippagePoints !== undefined ? entry.slippagePoints : null,
      slippageType: entry.slippageType || 'Zero',
      latencyMs: entry.executionLatencyMs !== undefined && entry.executionLatencyMs !== null 
        ? entry.executionLatencyMs 
        : (entry.latencyMs ?? null),
    } : null;

    const exitExecution = exit ? {
      priceRequested: exit.priceRequested ?? null,
      priceExecuted: exit.priceExecuted ?? null,
      slippagePoints: exit.slippagePoints !== undefined ? exit.slippagePoints : null,
      slippageType: exit.slippageType || 'Zero',
      latencyMs: exit.executionLatencyMs !== undefined && exit.executionLatencyMs !== null 
        ? exit.executionLatencyMs 
        : (exit.latencyMs ?? null),
    } : null;

    // Calculate signed slippages (Adverse is positive cost, Favorable is negative cost/savings)
    const getSignedSlippage = (exec: any) => {
      if (!exec || exec.slippagePoints === null || exec.slippagePoints === undefined) return 0;
      if (exec.slippageType === 'Adverse') return exec.slippagePoints;
      if (exec.slippageType === 'Favorable') return -exec.slippagePoints;
      return 0;
    };

    const entrySigned = getSignedSlippage(entryExecution);
    const exitSigned = getSignedSlippage(exitExecution);
    const netSigned = entrySigned + exitSigned;

    let netSlippagePoints = Math.abs(netSigned);
    let netSlippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A' = 'Zero';
    
    if (netSigned > 0.01) {
      netSlippageType = 'Adverse';
    } else if (netSigned < -0.01) {
      netSlippageType = 'Favorable';
    } else {
      netSlippageType = 'Zero';
    }

    if ((!entry || entry.priceExecuted === null) && (!exit || exit.priceExecuted === null)) {
      netSlippageType = 'N/A';
      netSlippagePoints = 0;
    }

    const netSlippage = {
      slippagePoints: parseFloat(netSlippagePoints.toFixed(1)),
      slippageType: netSlippageType,
    };

    const grossAdverseSlippage = (entryExecution?.slippageType === 'Adverse' ? (entryExecution.slippagePoints ?? 0) : 0) +
                                 (exitExecution?.slippageType === 'Adverse' ? (exitExecution.slippagePoints ?? 0) : 0);

    const grossFavorableSlippage = (entryExecution?.slippageType === 'Favorable' ? (entryExecution.slippagePoints ?? 0) : 0) +
                                   (exitExecution?.slippageType === 'Favorable' ? (exitExecution.slippagePoints ?? 0) : 0);

    // Latency calculations independently
    const entryLatency = entryExecution?.latencyMs ?? null;
    const exitLatency = exitExecution?.latencyMs ?? null;
    const cumulativeLatency = (entryLatency ?? 0) + (exitLatency ?? 0);
    
    let divisor = 0;
    if (entryLatency !== null) divisor++;
    if (exitLatency !== null) divisor++;
    const averageLatency = divisor > 0 ? cumulativeLatency / divisor : null;

    return {
      entryExecution,
      exitExecution,
      netSlippage,
      grossAdverseSlippage: parseFloat(grossAdverseSlippage.toFixed(1)),
      grossFavorableSlippage: parseFloat(grossFavorableSlippage.toFixed(1)),
      entryLatency,
      exitLatency,
      cumulativeLatency: parseFloat(cumulativeLatency.toFixed(1)),
      averageLatency: averageLatency !== null ? parseFloat(averageLatency.toFixed(1)) : null,
    };
  }
}
