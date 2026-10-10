import { Injectable, Logger } from '@nestjs/common';
import { CorrelatedIncident } from '../journal/correlation.engine';

export interface CalculatedMetrics {
  totalObservableExecutionTimeMs: number | null;
  routingDelayMs: number | null;
  executionRequestDelayMs: number | null;
  executionProcessingMs: number | null;
  dealerBridgeResponseTimeMs: number | null;
  pendingWaitingTimeMs: number | null;
  holdTimeMs: number | null;
  timestamp?: string | null;
  
  slippagePoints: number | null;
  slippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A' | 'NOT_OBSERVABLE';
  slippageWarning?: string | null;
  quoteBenchmark?: number | null;
  pendingLimitPrice?: number | null;
  priceImprovementPoints?: number | null;
  rawPriceDifference?: number | null;
  tickSize?: number | null;
  executionReason: 'MARKET' | 'PENDING_ORDER' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'MANUAL_CLOSE' | 'PARTIAL_CLOSE' | 'OTHER';
  orderType: 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP' | 'BUY_STOP_LIMIT' | 'SELL_STOP_LIMIT';
  status: 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'INCOMPLETE' | 'UNKNOWN' | 'PARTIAL';
  executed: boolean;
  isNormal: boolean;
  priceDelta: number;
  digits: number | null;
  pointSize: number | null;
  pointSizeSource?: 'MT5_SERVER' | 'HEURISTIC' | 'CONFIG' | 'UNKNOWN' | 'NOT_OBSERVABLE';
  priceRequested?: number | null;
  priceExecuted?: number | null;
  
  // Expose detailed IDs
  positionId?: string | null;
  orderId?: string | null;
  dealId?: string | null;
  requestId?: string | null;
  ticketId?: string | null;
  volume?: number | null;
  symbol?: string | null;
  action?: string | null;
  
  rejection?: {
    isRejected: boolean;
    reason: string | null;
    rawReason: string | null;
    rejectedBy: string | null;
    failedStage: string | null;
    lastSuccessfulStage: string | null;
  };
  
  timingQuality?: 'KNOWN' | 'NOT_OBSERVABLE' | 'UNKNOWN' | 'AMBIGUOUS' | 'INCOMPLETE';
  executionQuality?: 'KNOWN' | 'NOT_OBSERVABLE' | 'UNKNOWN' | 'AMBIGUOUS' | 'INCOMPLETE';
  timezoneQuality?: 'KNOWN' | 'NOT_OBSERVABLE' | 'UNKNOWN' | 'AMBIGUOUS' | 'INCOMPLETE';
  
  executionDetails?: {
    requestedVolume?: number;
    requestedPrice?: number;
    requestTimestamp?: string;
    orderId?: string;
    requestId?: string;
    dealId?: string | null;
    rejectedBy?: 'CLIENT_REQUEST' | 'SERVER' | 'DEALER' | 'LIQUIDITY/EXECUTION' | 'UNKNOWN';
    rejectionCode?: string;
    rawRejectionReason?: string;
    normalizedRejectionReason?: string;
    dealerResponse?: string | null;
    isDealCreated: boolean;
    isRetriedSuccessfully: boolean;
    requoteSequence?: Array<{
      timestamp: string;
      price: number;
      volume: number;
    }>;
  };
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger('MetricsService');

  calculate(
    incident: CorrelatedIncident,
    digits: number | null = null,
    point: number | null = null,
    pointSizeSource?: 'MT5_SERVER' | 'HEURISTIC' | 'NOT_OBSERVABLE',
  ): CalculatedMetrics {
    const { events, symbol, action } = incident;

    // Find execution outcome event
    const dealExecEvent = events.find((e) => e.eventType === 'DEAL_EXECUTED' || e.eventType === 'ORDER_FILLED');
    const outcomeTime = dealExecEvent ? new Date(dealExecEvent.timestamp).getTime() : Infinity;

    // Associate execution attempts: pick candidate immediately preceding execution if multiple exist
    const priorTriggers = events.filter((e) => e.eventType === 'ORDER_TRIGGERED' && new Date(e.timestamp).getTime() <= outcomeTime);
    const orderTriggeredEvent = priorTriggers.length > 0 ? priorTriggers[priorTriggers.length - 1] : events.find((e) => e.eventType === 'ORDER_TRIGGERED');

    const priorRequests = events.filter((e) => e.eventType === 'REQUEST' && new Date(e.timestamp).getTime() <= outcomeTime);
    const requestEvent = priorRequests.length > 0 ? priorRequests[priorRequests.length - 1] : events.find((e) => e.eventType === 'REQUEST');

    const priorRoutes = events.filter((e) => e.eventType === 'ROUTED' && new Date(e.timestamp).getTime() <= outcomeTime);
    const routeEvent = priorRoutes.length > 0 ? priorRoutes[priorRoutes.length - 1] : events.find((e) => e.eventType === 'ROUTED');

    const priorExecReqs = events.filter((e) => e.eventType === 'EXECUTION_REQUEST' && new Date(e.timestamp).getTime() <= outcomeTime);
    const execReqEvent = priorExecReqs.length > 0 ? priorExecReqs[priorExecReqs.length - 1] : events.find((e) => e.eventType === 'EXECUTION_REQUEST');

    const priorExecResps = events.filter((e) => e.eventType === 'EXECUTION_RESPONSE' && new Date(e.timestamp).getTime() <= outcomeTime);
    const execResEvent = priorExecResps.length > 0 ? priorExecResps[priorExecResps.length - 1] : events.find((e) => e.eventType === 'EXECUTION_RESPONSE');

    const orderPlacedEvent = events.find((e) => e.eventType === 'ORDER_PLACED');
    const rejectEvent = events.find((e) => e.eventType === 'ORDER_REJECTED');
    const cancelEvent = events.find((e) => e.eventType === 'ORDER_CANCELLED');

    const hasExecution = !!dealExecEvent;
    const hasRejection = !!rejectEvent;
    const hasCancellation = !!cancelEvent;

    // Identify IDs generically
    const findMetaVal = (key: string) => {
      for (const ev of events) {
        if (ev.metadata) {
          const meta = ev.metadata as any;
          if (meta[key] !== undefined && meta[key] !== null) {
            return String(meta[key]);
          }
        }
      }
      return null;
    };

    const positionId = findMetaVal('positionId') || incident.ticketId || null;
    const orderId = findMetaVal('orderId') || findMetaVal('ticket') || null;
    const dealId = findMetaVal('dealId') || null;
    const requestId = findMetaVal('requestId') || null;
    const ticketId = incident.ticketId || findMetaVal('ticket') || null;

    // Determine status
    let status: 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'INCOMPLETE' | 'UNKNOWN' = 'UNKNOWN';
    let executed = false;

    if (hasExecution) {
      status = 'EXECUTED';
      executed = true;
    } else if (hasRejection) {
      status = 'REJECTED';
    } else if (hasCancellation) {
      status = 'CANCELLED';
    } else if (requestEvent || orderPlacedEvent) {
      status = 'INCOMPLETE';
    }

    // Chronology Validation
    let chronologyError = false;
    const checkOrder = (t1: string, t2: string) => new Date(t1).getTime() <= new Date(t2).getTime();

    if (requestEvent && routeEvent && !checkOrder(requestEvent.timestamp, routeEvent.timestamp)) chronologyError = true;
    if (routeEvent && execReqEvent && !checkOrder(routeEvent.timestamp, execReqEvent.timestamp)) chronologyError = true;
    if (execReqEvent && execResEvent && !checkOrder(execReqEvent.timestamp, execResEvent.timestamp)) chronologyError = true;
    if (execReqEvent && dealExecEvent && !checkOrder(execReqEvent.timestamp, dealExecEvent.timestamp)) chronologyError = true;

    // Determine starting timestamp for latency
    // For pending orders, execution latency starts when order is triggered
    const startEvent = orderTriggeredEvent || requestEvent;

    let totalObservableExecutionTimeMs: number | null = null;
    let routingDelayMs: number | null = null;
    let executionRequestDelayMs: number | null = null;
    let executionProcessingMs: number | null = null;
    let dealerBridgeResponseTimeMs: number | null = null;
    let pendingWaitingTimeMs: number | null = null;

    if (!chronologyError) {
      if (startEvent && dealExecEvent) {
        totalObservableExecutionTimeMs = new Date(dealExecEvent.timestamp).getTime() - new Date(startEvent.timestamp).getTime();
        if (totalObservableExecutionTimeMs < 0) totalObservableExecutionTimeMs = 0;
      }

      if (requestEvent && routeEvent) {
        routingDelayMs = new Date(routeEvent.timestamp).getTime() - new Date(requestEvent.timestamp).getTime();
        if (routingDelayMs < 0) routingDelayMs = 0;
      }

      if (routeEvent && execReqEvent) {
        executionRequestDelayMs = new Date(execReqEvent.timestamp).getTime() - new Date(routeEvent.timestamp).getTime();
        if (executionRequestDelayMs < 0) executionRequestDelayMs = 0;
      }

      if (execReqEvent && dealExecEvent) {
        executionProcessingMs = new Date(dealExecEvent.timestamp).getTime() - new Date(execReqEvent.timestamp).getTime();
        if (executionProcessingMs < 0) executionProcessingMs = 0;
      }

      if (execReqEvent && execResEvent) {
        dealerBridgeResponseTimeMs = new Date(execResEvent.timestamp).getTime() - new Date(execReqEvent.timestamp).getTime();
        if (dealerBridgeResponseTimeMs < 0) dealerBridgeResponseTimeMs = 0;
      }

      if (!execReqEvent && (routeEvent || requestEvent)) {
        const start = routeEvent || requestEvent;
        if (start) {
          if (dealExecEvent) {
            executionProcessingMs = new Date(dealExecEvent.timestamp).getTime() - new Date(start.timestamp).getTime();
            if (executionProcessingMs < 0) executionProcessingMs = 0;
          }
          if (execResEvent) {
            dealerBridgeResponseTimeMs = new Date(execResEvent.timestamp).getTime() - new Date(start.timestamp).getTime();
            if (dealerBridgeResponseTimeMs < 0) dealerBridgeResponseTimeMs = 0;
          }
          if (routeEvent) {
            executionRequestDelayMs = 0;
          }
        }
      }

      if (orderPlacedEvent && orderTriggeredEvent) {
        pendingWaitingTimeMs = new Date(orderTriggeredEvent.timestamp).getTime() - new Date(orderPlacedEvent.timestamp).getTime();
        if (pendingWaitingTimeMs < 0) pendingWaitingTimeMs = 0;
      }
    }

    // Determine execution reason
    let executionReason: CalculatedMetrics['executionReason'] = 'MARKET';
    let rawLogsText = events.map((e) => e.rawMessage.toLowerCase()).join(' ');

    if (rawLogsText.includes('stop loss') || rawLogsText.includes('[sl]') || rawLogsText.includes('s/l')) {
      executionReason = 'STOP_LOSS';
    } else if (rawLogsText.includes('take profit') || rawLogsText.includes('[tp]') || rawLogsText.includes('t/p')) {
      executionReason = 'TAKE_PROFIT';
    } else if (orderTriggeredEvent || orderPlacedEvent) {
      executionReason = 'PENDING_ORDER';
    } else if (rawLogsText.includes('close') || rawLogsText.includes('close #')) {
      executionReason = 'MANUAL_CLOSE';
    }

    // Determine orderType
    let orderType: CalculatedMetrics['orderType'] = 'MARKET';
    if (rawLogsText.includes('buy limit')) orderType = 'BUY_LIMIT';
    else if (rawLogsText.includes('sell limit')) orderType = 'SELL_LIMIT';
    else if (rawLogsText.includes('buy stop limit')) orderType = 'BUY_STOP_LIMIT';
    else if (rawLogsText.includes('sell stop limit')) orderType = 'SELL_STOP_LIMIT';
    else if (rawLogsText.includes('buy stop')) orderType = 'BUY_STOP';
    else if (rawLogsText.includes('sell stop')) orderType = 'SELL_STOP';

    // Dynamic point size and source tracking
    let pointSize = point ?? (digits !== null ? Math.pow(10, -digits) : null);
    let finalPointSizeSource: CalculatedMetrics['pointSizeSource'] = pointSizeSource || (pointSize !== null ? 'MT5_SERVER' : 'HEURISTIC');

    if (pointSize === null && symbol && symbol !== 'UNKNOWN') {
      const isJpyOrMetal = symbol.toUpperCase().includes('JPY') ||
                          symbol.toUpperCase().includes('XAU') ||
                          symbol.toUpperCase().includes('GOLD') ||
                          symbol.toUpperCase().includes('XAG') ||
                          symbol.toUpperCase().includes('SILVER');
      pointSize = isJpyOrMetal ? 0.01 : 0.00001;
      finalPointSizeSource = 'HEURISTIC';
    }

    // Slippage
    let priceDelta = 0;
    let slippagePoints: number | null = null;
    let slippageType: CalculatedMetrics['slippageType'] = 'NOT_OBSERVABLE';
    let slippageWarning: string | null = null;
    let quoteBenchmark: number | null = null;
    let pendingLimitPrice: number | null = null;
    let priceImprovementPoints: number | null = null;

    const isPendingOrder = !!(
      orderTriggeredEvent ||
      orderPlacedEvent ||
      ['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP', 'BUY_STOP_LIMIT', 'SELL_STOP_LIMIT'].includes(orderType)
    );

    const finalPrice = dealExecEvent?.metadata?.priceExecuted;

    if (isPendingOrder) {
      pendingLimitPrice = orderPlacedEvent?.metadata?.priceRequested ?? orderTriggeredEvent?.metadata?.priceRequested ?? null;
      if (orderTriggeredEvent?.metadata?.priceActivation !== undefined && orderTriggeredEvent.metadata.priceActivation !== null) {
        quoteBenchmark = orderTriggeredEvent.metadata.priceActivation;
      } else if (action === 'BUY' && orderTriggeredEvent?.metadata?.activationAsk !== undefined && orderTriggeredEvent.metadata.activationAsk !== null) {
        quoteBenchmark = orderTriggeredEvent.metadata.activationAsk;
      } else if (action === 'SELL' && orderTriggeredEvent?.metadata?.activationBid !== undefined && orderTriggeredEvent.metadata.activationBid !== null) {
        quoteBenchmark = orderTriggeredEvent.metadata.activationBid;
      } else if (orderTriggeredEvent?.metadata?.activationPrice !== undefined && orderTriggeredEvent.metadata.activationPrice !== null) {
        quoteBenchmark = orderTriggeredEvent.metadata.activationPrice;
      }

      if (hasExecution && finalPrice !== undefined && finalPrice !== null) {
        // Price improvement against pending limit price
        if (pendingLimitPrice !== null && pointSize !== null && pointSize > 0) {
          const improvement = action === 'BUY' ? (pendingLimitPrice - finalPrice) : (finalPrice - pendingLimitPrice);
          priceImprovementPoints = parseFloat((improvement / pointSize).toFixed(1));
        }

        // Quote-to-fill slippage against market quote benchmark at activation
        if (quoteBenchmark !== null && quoteBenchmark !== undefined) {
          priceDelta = finalPrice - quoteBenchmark;
          if (pointSize !== null && pointSize > 0) {
            slippagePoints = Math.abs(priceDelta) / pointSize;
            if (Math.abs(priceDelta) < 1e-8) {
              slippageType = 'Zero';
            } else if (action === 'BUY') {
              slippageType = priceDelta > 0 ? 'Adverse' : 'Favorable';
            } else {
              slippageType = priceDelta < 0 ? 'Adverse' : 'Favorable';
            }
          } else {
            slippagePoints = null;
            slippageType = 'NOT_OBSERVABLE';
            slippageWarning = 'Symbol point size unavailable for slippage calculation';
          }
        } else {
          slippagePoints = null;
          slippageType = 'NOT_OBSERVABLE';
          slippageWarning = 'Market activation quote unobservable; pending order limit price is not a market slippage benchmark';
        }
      } else {
        slippagePoints = null;
        slippageType = 'NOT_OBSERVABLE';
        slippageWarning = hasExecution ? 'Missing execution price' : 'Order not executed';
      }
    } else {
      // Market order or direct execution request
      const initialPrice = requestEvent?.metadata?.priceRequested ?? execReqEvent?.metadata?.priceRequested;

      if (hasExecution && finalPrice !== undefined && finalPrice !== null) {
        if (initialPrice !== undefined && initialPrice !== null && !isNaN(initialPrice) && initialPrice > 0) {
          priceDelta = finalPrice - initialPrice;
          if (pointSize !== null && pointSize > 0) {
            slippagePoints = Math.abs(priceDelta) / pointSize;
            if (Math.abs(priceDelta) < 1e-8) {
              slippageType = 'Zero';
            } else if (action === 'BUY') {
              slippageType = priceDelta > 0 ? 'Adverse' : 'Favorable';
            } else {
              slippageType = priceDelta < 0 ? 'Adverse' : 'Favorable';
            }
          } else {
            slippagePoints = null;
            slippageType = 'NOT_OBSERVABLE';
            slippageWarning = 'Symbol point size unavailable for slippage calculation';
          }
        } else {
          priceDelta = 0;
          slippagePoints = null;
          slippageType = 'NOT_OBSERVABLE';
          slippageWarning = 'Market order executed without observable requested price baseline';
        }
      } else {
        priceDelta = 0;
        slippagePoints = null;
        slippageType = 'NOT_OBSERVABLE';
        slippageWarning = hasExecution ? 'Missing execution price' : 'Order not executed';
      }
    }

    // Determine timezone/timing/execution qualities
    let timingQuality: CalculatedMetrics['timingQuality'] = 'KNOWN';
    let executionQuality: CalculatedMetrics['executionQuality'] = 'KNOWN';
    let timezoneQuality: CalculatedMetrics['timezoneQuality'] = 'KNOWN';

    // timezone quality based on timezoneSource
    const timezoneSources = events.map(e => e.timezoneSource).filter(Boolean);
    const uniqueSources = [...new Set(timezoneSources)];
    if (uniqueSources.includes('UNKNOWN')) {
      timezoneQuality = 'UNKNOWN';
    } else if (uniqueSources.length > 1) {
      timezoneQuality = 'AMBIGUOUS';
    }

    // timing quality based on timezone and chronology/events
    if (!hasExecution && !hasRejection && !hasCancellation) {
      executionQuality = 'INCOMPLETE';
    }
    if (!hasExecution) {
      executionQuality = 'NOT_OBSERVABLE';
    }
    if (chronologyError || !startEvent || (!dealExecEvent && !rejectEvent && !cancelEvent)) {
      timingQuality = 'NOT_OBSERVABLE';
    }

    // Verify timezone alignment for timing
    const explicitOffsetEvents = events.filter(e => e.timezoneSource === 'EXPLICIT_OFFSET');
    const unknownOffsetEvents = events.filter(e => e.timezoneSource === 'UNKNOWN');
    if (explicitOffsetEvents.length > 0 && unknownOffsetEvents.length > 0) {
      timingQuality = 'NOT_OBSERVABLE';
    } else if (explicitOffsetEvents.length > 1) {
      // check unique offsets
      const offsets = explicitOffsetEvents.map(e => {
        const match = e.timestampRaw ? e.timestampRaw.match(/([+-]\d{2}:\d{2}|Z)$/) : null;
        return match ? match[0] : '';
      });
      const uniqueOffsets = [...new Set(offsets)];
      if (uniqueOffsets.length > 1) {
        timingQuality = 'NOT_OBSERVABLE';
      }
    }

    // Rejection analysis
    let rejection = undefined;
    let executionDetails: CalculatedMetrics['executionDetails'] = undefined;

    const MT5_RETCODES: Record<string, string> = {
      '10004': 'REQUOTE',
      '10006': 'REJECTED',
      '10013': 'INVALID_PRICE',
      '10014': 'INVALID_VOLUME',
      '10015': 'MARKET_CLOSED',
      '10016': 'INVALID_STOPS',
      '10018': 'TRADE_DISABLED',
      '10019': 'NO_MONEY',
      '10021': 'TRADE_CONTEXT_BUSY',
      '10026': 'SERVER_BUSY',
      '10034': 'EXPIRED',
    };

    // Populate executionDetails
    const activeRequest = requestEvent || execReqEvent || orderPlacedEvent;
    const isDealCreated = !!dealExecEvent;
    const isRetriedSuccessfully = isDealCreated;

    // Gather all dealer responses or requote sequences
    const requoteSequence: Array<{ timestamp: string; price: number; volume: number }> = [];
    const dealerRequoteEvents = events.filter(e => e.eventType === 'REQUOTED');
    for (const reqEv of dealerRequoteEvents) {
      if (reqEv.metadata.requotePrice !== undefined) {
        requoteSequence.push({
          timestamp: reqEv.timestampUtc || reqEv.timestampServer || reqEv.timestamp,
          price: reqEv.metadata.requotePrice,
          volume: reqEv.metadata.volume || 0,
        });
      }
    }

    if (hasRejection) {
      const rejectEv = rejectEvent;
      const rawReason = rejectEv.metadata.rawReason || '';
      
      rejection = {
        isRejected: true,
        reason: rawReason || 'Request rejected',
        rawReason: rawReason || null,
        rejectedBy: rejectEv.metadata.dealerId || 'MT5 Server',
        failedStage: 'Execution Request',
        lastSuccessfulStage: routeEvent ? 'Routing' : 'Client Request',
      };

      // Classify rejection source deterministically
      let rejectedBySource: 'CLIENT_REQUEST' | 'SERVER' | 'DEALER' | 'LIQUIDITY/EXECUTION' | 'UNKNOWN' = 'UNKNOWN';
      if (rejectEv.metadata.dealerId || rejectEv.rawMessage.includes('[Dealer]') || rejectEv.metadata.rejectedBy?.includes('Dealer')) {
        rejectedBySource = 'DEALER';
      } else if (rawReason.toLowerCase().includes('money') || rawReason.toLowerCase().includes('margin') || rejectEv.metadata.rejectedBy === 'Risk Management System') {
        rejectedBySource = 'SERVER';
      } else if (rawReason.toLowerCase().includes('invalid volume') || rawReason.toLowerCase().includes('invalid stops') || rawReason.toLowerCase().includes('invalid price') || rawReason.toLowerCase().includes('stops')) {
        rejectedBySource = 'CLIENT_REQUEST';
      } else if (rawReason.toLowerCase().includes('off quotes') || rawReason.toLowerCase().includes('requote') || rawReason.toLowerCase().includes('no prices') || rawReason.toLowerCase().includes('prices')) {
        rejectedBySource = 'LIQUIDITY/EXECUTION';
      } else if (rawReason.toLowerCase().includes('disabled') || rawReason.toLowerCase().includes('closed') || rawReason.toLowerCase().includes('market closed')) {
        rejectedBySource = 'SERVER';
      }

      // Check retcode
      const retcodeMatch = rejectEv.rawMessage.match(/retcode\s*[:#\s]*(\d+)/i);
      const rejectionCode = retcodeMatch ? retcodeMatch[1] : undefined;
      
      let normalizedRejectionReason = rejectionCode ? MT5_RETCODES[rejectionCode] : undefined;
      if (!normalizedRejectionReason) {
        if (rawReason.toLowerCase().includes('money') || rawReason.toLowerCase().includes('margin')) {
          normalizedRejectionReason = 'NO_MONEY';
        } else if (rawReason.toLowerCase().includes('volume')) {
          normalizedRejectionReason = 'INVALID_VOLUME';
        } else if (rawReason.toLowerCase().includes('market closed') || rawReason.toLowerCase().includes('closed')) {
          normalizedRejectionReason = 'MARKET_CLOSED';
        } else if (rawReason.toLowerCase().includes('off quotes') || rawReason.toLowerCase().includes('requote')) {
          normalizedRejectionReason = 'REQUOTE';
        } else if (rawReason.toLowerCase().includes('stops')) {
          normalizedRejectionReason = 'INVALID_STOPS';
        } else if (rawReason.toLowerCase().includes('disabled')) {
          normalizedRejectionReason = 'TRADE_DISABLED';
        }
      }

      const dealerResponse = rejectEv.metadata.dealerId ? `Dealer #${rejectEv.metadata.dealerId} rejected` : null;

      executionDetails = {
        requestedVolume: activeRequest?.metadata?.volume,
        requestedPrice: activeRequest?.metadata?.priceRequested,
        requestTimestamp: activeRequest ? (activeRequest.timestampUtc || activeRequest.timestampServer || activeRequest.timestamp) : undefined,
        orderId: rejectEv.metadata.orderId || activeRequest?.metadata?.orderId,
        requestId: rejectEv.metadata.requestId || activeRequest?.metadata?.requestId,
        dealId: null,
        rejectedBy: rejectedBySource,
        rejectionCode,
        rawRejectionReason: rawReason || undefined,
        normalizedRejectionReason,
        dealerResponse,
        isDealCreated,
        isRetriedSuccessfully,
        requoteSequence: requoteSequence.length > 0 ? requoteSequence : undefined,
      };
    } else {
      executionDetails = {
        requestedVolume: activeRequest?.metadata?.volume,
        requestedPrice: activeRequest?.metadata?.priceRequested,
        requestTimestamp: activeRequest ? (activeRequest.timestampUtc || activeRequest.timestampServer || activeRequest.timestamp) : undefined,
        orderId: dealExecEvent?.metadata?.orderId || activeRequest?.metadata?.orderId,
        requestId: dealExecEvent?.metadata?.requestId || activeRequest?.metadata?.requestId,
        dealId: dealExecEvent?.metadata?.dealId || null,
        isDealCreated,
        isRetriedSuccessfully,
        requoteSequence: requoteSequence.length > 0 ? requoteSequence : undefined,
      };
    }

    return {
      totalObservableExecutionTimeMs,
      routingDelayMs,
      executionRequestDelayMs,
      executionProcessingMs,
      dealerBridgeResponseTimeMs,
      pendingWaitingTimeMs,
      timestamp: dealExecEvent?.timestamp || null,
      holdTimeMs: null, // Hold time is round-trip and filled in analyzeExecution

      slippagePoints: slippagePoints !== null ? parseFloat(slippagePoints.toFixed(1)) : null,
      slippageType,
      slippageWarning,
      quoteBenchmark,
      pendingLimitPrice,
      priceImprovementPoints,
      rawPriceDifference: parseFloat(priceDelta.toFixed(5)),
      executionReason,
      orderType,
      status,
      executed,
      isNormal: executed && (totalObservableExecutionTimeMs !== null && totalObservableExecutionTimeMs < 300) && slippageType !== 'Adverse',
      priceDelta: parseFloat(priceDelta.toFixed(5)),
      digits,
      pointSize,
      pointSizeSource: finalPointSizeSource,
      priceRequested: isPendingOrder ? (pendingLimitPrice ?? null) : (requestEvent?.metadata?.priceRequested ?? null),
      priceExecuted: hasExecution ? finalPrice : null,
      
      // IDs
      positionId,
      orderId,
      dealId,
      requestId,
      ticketId,
      volume: incident.volume || null,
      symbol: incident.symbol || null,
      action: incident.action || null,

      rejection,
      timingQuality,
      executionQuality,
      timezoneQuality,
      executionDetails,
    };
  }

  analyzeExecution(entry: any, exit: any): any {
    const entryExecution = entry ? {
      priceRequested: entry.priceRequested ?? null,
      priceExecuted: entry.priceExecuted ?? null,
      quoteBenchmark: entry.quoteBenchmark ?? null,
      pendingLimitPrice: entry.pendingLimitPrice ?? null,
      priceImprovementPoints: entry.priceImprovementPoints ?? null,
      slippagePoints: entry.slippagePoints !== undefined ? entry.slippagePoints : null,
      slippageType: entry.slippageType || 'NOT_OBSERVABLE',
      slippageWarning: entry.slippageWarning ?? null,
      totalObservableExecutionTimeMs: entry.totalObservableExecutionTimeMs ?? null,
      routingDelayMs: entry.routingDelayMs ?? null,
      executionRequestDelayMs: entry.executionRequestDelayMs ?? null,
      executionProcessingMs: entry.executionProcessingMs ?? null,
      dealerBridgeResponseTimeMs: entry.dealerBridgeResponseTimeMs ?? null,
      pendingWaitingTimeMs: entry.pendingWaitingTimeMs ?? null,
    } : null;

    const exitExecution = exit ? {
      priceRequested: exit.priceRequested ?? null,
      priceExecuted: exit.exit?.priceExecuted ?? exit.priceExecuted ?? null,
      quoteBenchmark: exit.quoteBenchmark ?? null,
      pendingLimitPrice: exit.pendingLimitPrice ?? null,
      priceImprovementPoints: exit.priceImprovementPoints ?? null,
      slippagePoints: exit.slippagePoints !== undefined ? exit.slippagePoints : null,
      slippageType: exit.slippageType || 'NOT_OBSERVABLE',
      slippageWarning: exit.slippageWarning ?? null,
      totalObservableExecutionTimeMs: exit.totalObservableExecutionTimeMs ?? null,
      routingDelayMs: exit.routingDelayMs ?? null,
      executionRequestDelayMs: exit.executionRequestDelayMs ?? null,
      executionProcessingMs: exit.executionProcessingMs ?? null,
      dealerBridgeResponseTimeMs: exit.dealerBridgeResponseTimeMs ?? null,
      pendingWaitingTimeMs: exit.pendingWaitingTimeMs ?? null,
    } : null;

    const hasEntrySlippage = entryExecution?.slippagePoints !== null && entryExecution?.slippagePoints !== undefined;
    const hasExitSlippage = exitExecution?.slippagePoints !== null && exitExecution?.slippagePoints !== undefined;

    // Calculate signed slippages
    const getSignedSlippage = (exec: any) => {
      if (!exec || exec.slippagePoints === null || exec.slippagePoints === undefined) return 0;
      return exec.slippageType === 'Adverse' ? exec.slippagePoints : (exec.slippageType === 'Favorable' ? -exec.slippagePoints : 0);
    };

    let netSlippagePoints: number | null = null;
    let netSlippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A' = 'N/A';
    let netWarning: string | null = null;

    if (!hasEntrySlippage && !hasExitSlippage) {
      netSlippagePoints = null;
      netSlippageType = 'N/A';
      netWarning = 'Requested quote baseline unobservable for both entry and exit legs';
    } else {
      const entrySigned = hasEntrySlippage ? getSignedSlippage(entryExecution) : 0;
      const exitSigned = hasExitSlippage ? getSignedSlippage(exitExecution) : 0;
      const netSigned = entrySigned + exitSigned;

      netSlippagePoints = parseFloat(Math.abs(netSigned).toFixed(1));
      if (netSigned > 0.01) {
        netSlippageType = 'Adverse';
      } else if (netSigned < -0.01) {
        netSlippageType = 'Favorable';
      } else {
        netSlippageType = 'Zero';
      }
    }

    // Cumulative & average execution latency (totalObservableExecutionTimeMs)
    const entryLat = entryExecution?.totalObservableExecutionTimeMs ?? null;
    const exitLat = exitExecution?.totalObservableExecutionTimeMs ?? null;
    let cumulativeLatency = null;
    let averageLatency = null;

    if (entryLat !== null && exitLat !== null) {
      cumulativeLatency = entryLat + exitLat;
      averageLatency = cumulativeLatency / 2;
    } else if (entryLat !== null) {
      cumulativeLatency = entryLat;
      averageLatency = entryLat;
    } else if (exitLat !== null) {
      cumulativeLatency = exitLat;
      averageLatency = exitLat;
    }

    // Hold time = Exit Execution Deal - Entry Execution Deal
    let holdTimeMs = null;
    if (entry && exit && entry.executed && exit.executed && entry.timestamp && exit.timestamp) {
      holdTimeMs = new Date(exit.timestamp).getTime() - new Date(entry.timestamp).getTime();
      if (holdTimeMs < 0) holdTimeMs = 0;
    }

    return {
      entryExecution,
      exitExecution,
      netSlippage: {
        slippagePoints: netSlippagePoints,
        slippageType: netSlippageType,
        warning: netWarning,
      },
      cumulativeLatency: cumulativeLatency !== null ? parseFloat(cumulativeLatency.toFixed(1)) : null,
      averageLatency: averageLatency !== null ? parseFloat(averageLatency.toFixed(1)) : null,
      holdTimeMs,
    };
  }
}
