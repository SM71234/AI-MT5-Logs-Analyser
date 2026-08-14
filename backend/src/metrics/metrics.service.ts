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
  slippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A';
  executionReason: 'MARKET' | 'PENDING_ORDER' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'MANUAL_CLOSE' | 'PARTIAL_CLOSE' | 'OTHER';
  orderType: 'MARKET' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP' | 'BUY_STOP_LIMIT' | 'SELL_STOP_LIMIT';
  status: 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'INCOMPLETE' | 'UNKNOWN' | 'PARTIAL';
  executed: boolean;
  isNormal: boolean;
  priceDelta: number;
  digits: number | null;
  pointSize: number | null;
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

    // Find lifecycle events
    const requestEvent = events.find((e) => e.eventType === 'REQUEST');
    const routeEvent = events.find((e) => e.eventType === 'ROUTED');
    const execReqEvent = events.find((e) => e.eventType === 'EXECUTION_REQUEST');
    const execResEvent = events.find((e) => e.eventType === 'EXECUTION_RESPONSE');
    const dealExecEvent = events.find((e) => e.eventType === 'DEAL_EXECUTED' || e.eventType === 'ORDER_FILLED');
    const orderPlacedEvent = events.find((e) => e.eventType === 'ORDER_PLACED');
    const orderTriggeredEvent = events.find((e) => e.eventType === 'ORDER_TRIGGERED');
    const rejectEvent = events.find((e) => e.eventType === 'ORDER_REJECTED');
    const cancelEvent = events.find((e) => e.eventType === 'ORDER_CANCELLED');

    const hasExecution = !!dealExecEvent;
    const hasRejection = !!rejectEvent;
    const hasCancellation = !!cancelEvent;

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

    // Slippage
    let priceDelta = 0;
    let slippagePoints: number | null = null;
    let slippageType: 'Adverse' | 'Favorable' | 'Zero' | 'N/A' = 'N/A';

    const initialPrice = requestEvent?.metadata?.priceRequested || orderPlacedEvent?.metadata?.priceRequested;
    const finalPrice = dealExecEvent?.metadata?.priceExecuted;

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
    }

    // Rejection analysis
    let rejection = undefined;
    if (hasRejection) {
      const rawReason = rejectEvent.metadata.rawReason || '';
      rejection = {
        isRejected: true,
        reason: rawReason || 'Request rejected',
        rawReason: rawReason || null,
        rejectedBy: rejectEvent.metadata.dealerId || 'MT5 Server',
        failedStage: 'Execution Request',
        lastSuccessfulStage: routeEvent ? 'Routing' : 'Client Request',
      };
    }

    const pointSize = point ?? (digits !== null ? Math.pow(10, -digits) : null);

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
      executionReason,
      orderType,
      status,
      executed,
      isNormal: executed && (totalObservableExecutionTimeMs !== null && totalObservableExecutionTimeMs < 300) && slippageType !== 'Adverse',
      priceDelta: parseFloat(priceDelta.toFixed(5)),
      digits,
      pointSize,
      priceRequested: initialPrice,
      priceExecuted: hasExecution ? finalPrice : null,
      rejection,
    };
  }

  analyzeExecution(entry: any, exit: any): any {
    const entryExecution = entry ? {
      priceRequested: entry.priceRequested ?? null,
      priceExecuted: entry.priceExecuted ?? null,
      slippagePoints: entry.slippagePoints !== undefined ? entry.slippagePoints : null,
      slippageType: entry.slippageType || 'Zero',
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
      slippagePoints: exit.slippagePoints !== undefined ? exit.slippagePoints : null,
      slippageType: exit.slippageType || 'Zero',
      totalObservableExecutionTimeMs: exit.totalObservableExecutionTimeMs ?? null,
      routingDelayMs: exit.routingDelayMs ?? null,
      executionRequestDelayMs: exit.executionRequestDelayMs ?? null,
      executionProcessingMs: exit.executionProcessingMs ?? null,
      dealerBridgeResponseTimeMs: exit.dealerBridgeResponseTimeMs ?? null,
      pendingWaitingTimeMs: exit.pendingWaitingTimeMs ?? null,
    } : null;

    // Calculate signed slippages
    const getSignedSlippage = (exec: any) => {
      if (!exec || exec.slippagePoints === null || exec.slippagePoints === undefined) return 0;
      return exec.slippageType === 'Adverse' ? exec.slippagePoints : (exec.slippageType === 'Favorable' ? -exec.slippagePoints : 0);
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
    if (entry?.priceExecuted && exit?.priceExecuted) {
      // Find the execution timestamps
      const entryTime = entry.timestamp;
      const exitTime = exit.timestamp;
      if (entryTime && exitTime) {
        holdTimeMs = new Date(exitTime).getTime() - new Date(entryTime).getTime();
        if (holdTimeMs < 0) holdTimeMs = 0;
      }
    }

    return {
      entryExecution,
      exitExecution,
      netSlippage: {
        slippagePoints: parseFloat(netSlippagePoints.toFixed(1)),
        slippageType: netSlippageType,
      },
      cumulativeLatency: cumulativeLatency !== null ? parseFloat(cumulativeLatency.toFixed(1)) : null,
      averageLatency: averageLatency !== null ? parseFloat(averageLatency.toFixed(1)) : null,
      holdTimeMs,
    };
  }
}
