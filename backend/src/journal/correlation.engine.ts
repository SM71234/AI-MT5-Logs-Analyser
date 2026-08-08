import { Injectable, Logger } from '@nestjs/common';
import { NormalizedEvent } from './normalization.engine';

export interface CorrelatedIncident {
  ticketId: string;
  login: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  volume: number;
  events: NormalizedEvent[];
}

@Injectable()
export class CorrelationEngine {
  private readonly logger = new Logger('CorrelationEngine');

  correlate(events: NormalizedEvent[]): CorrelatedIncident[] {
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const incidents: CorrelatedIncident[] = [];
    const unassociatedDealerEvents: NormalizedEvent[] = [];
    
    // Step 1: Filter unique execution events to avoid duplicates from multiple execution log formats
    const executionEvents = sortedEvents.filter((e) => e.eventType === 'ORDER_EXECUTED');
    const uniqueExecutions: NormalizedEvent[] = [];
    
    for (const exec of executionEvents) {
      const execTime = new Date(exec.timestamp).getTime();
      
      const isDuplicate = uniqueExecutions.some((e) => {
        if (exec.metadata.dealId && e.metadata.dealId === exec.metadata.dealId) return true;
        if (exec.metadata.orderId && e.metadata.orderId === exec.metadata.orderId) return true;
        
        const t = new Date(e.timestamp).getTime();
        return Math.abs(t - execTime) <= 1000 && 
               e.metadata.symbol === exec.metadata.symbol &&
               e.metadata.volume === exec.metadata.volume;
      });
      
      if (!isDuplicate) {
        uniqueExecutions.push(exec);
      }
    }

    for (const exec of uniqueExecutions) {
      const ticketId = exec.metadata.ticket || exec.metadata.dealId || exec.metadata.orderId || '';
      const login = exec.login;
      const symbol = exec.metadata.symbol || '';
      const action = exec.metadata.action || 'BUY';
      const volume = exec.metadata.volume || 0;
      const execTime = new Date(exec.timestamp).getTime();

      // Resolve orderId associated with this execution event
      let orderId = exec.metadata.orderId;
      if (!orderId && exec.metadata.dealId) {
        // Look for corresponding ORDER_PERFORMED or similar event that matches timestamp/executed details and exposes orderId
        const perfEvent = sortedEvents.find(
          (e) => e.eventType === 'ORDER_EXECUTED' && 
                 e.metadata.orderId && 
                 e.metadata.symbol === symbol &&
                 Math.abs(new Date(e.timestamp).getTime() - execTime) <= 1000
        );
        if (perfEvent) {
          orderId = perfEvent.metadata.orderId;
        }
      }

      // Step 2: Find matching ORDER_SUBMITTED event
      let submitEvent: NormalizedEvent | undefined;
      
      // Rule A: Match by explicit Order ID
      if (orderId) {
        submitEvent = sortedEvents.find(
          (e) => e.eventType === 'ORDER_SUBMITTED' && e.metadata.orderId === orderId
        );
      }
      
      // Rule B: Fallback to side-specific timestamp proximity (BUY requests for BUY execution, SELL for SELL)
      if (!submitEvent) {
        submitEvent = sortedEvents.find((e) => {
          if (e.eventType !== 'ORDER_SUBMITTED') return false;
          if (e.login !== login) return false;
          if (e.metadata.symbol && e.metadata.symbol !== symbol) return false;
          if (e.metadata.volume !== undefined && e.metadata.volume !== volume) return false;
          // Side-specific matching is crucial: BUY maps to BUY, SELL maps to SELL
          if (e.metadata.action && e.metadata.action !== action) return false;

          const eventTime = new Date(e.timestamp).getTime();
          return eventTime <= execTime && execTime - eventTime <= 15000;
        });
      }

      const relatedClientEvents: NormalizedEvent[] = [];
      if (submitEvent) {
        relatedClientEvents.push(submitEvent);
      }

      // Collect intermediate server acceptance or routing events
      const submitTime = submitEvent ? new Date(submitEvent.timestamp).getTime() : 0;
      for (const e of sortedEvents) {
        if (e.login === login && e !== exec && e !== submitEvent) {
          if (orderId && e.metadata.orderId === orderId) {
            relatedClientEvents.push(e);
          } else if (!orderId) {
            const t = new Date(e.timestamp).getTime();
            if (t >= submitTime && t <= execTime && e.metadata.symbol === symbol) {
              relatedClientEvents.push(e);
            }
          }
        }
      }

      // Add the unique execution event itself
      // In case we have both deal performed and order performed, add both to the incident sequence for display
      const matchingExecs = sortedEvents.filter((e) => {
        if (e.eventType !== 'ORDER_EXECUTED') return false;
        // Same dealId or same orderId
        if (exec.metadata.dealId && e.metadata.dealId === exec.metadata.dealId) return true;
        if (orderId && e.metadata.orderId === orderId) return true;
        // Fallback to exact timestamp match
        return new Date(e.timestamp).getTime() === execTime && e.metadata.symbol === symbol;
      });

      incidents.push({
        ticketId,
        login,
        symbol,
        action,
        volume,
        events: [...relatedClientEvents, ...matchingExecs],
      });
    }

    // Step 3: Correlate dealer logs to active client incident sequences
    const dealerEvents = sortedEvents.filter(
      (e) => e.eventType === 'DEALER_ACCEPTED' || e.eventType === 'DEALER_REQUOTED',
    );

    for (const dealerEv of dealerEvents) {
      const symbol = dealerEv.metadata.symbol;
      const volume = dealerEv.metadata.volume;
      const dealerTime = new Date(dealerEv.timestamp).getTime();

      const targetIncident = incidents.find((incident) => {
        if (incident.symbol !== symbol || incident.volume !== volume) return false;

        const submitEvent = incident.events.find((e) => e.eventType === 'ORDER_SUBMITTED');
        const execEvent = incident.events.find((e) => e.eventType === 'ORDER_EXECUTED');
        
        if (!submitEvent || !execEvent) return false;

        const submitTime = new Date(submitEvent.timestamp).getTime();
        const execTime = new Date(execEvent.timestamp).getTime();

        return dealerTime >= submitTime - 2000 && dealerTime <= execTime + 1000;
      });

      if (targetIncident) {
        if (!targetIncident.events.some((e) => e.rawMessage === dealerEv.rawMessage)) {
          targetIncident.events.push(dealerEv);
        }
      } else {
        unassociatedDealerEvents.push(dealerEv);
      }
    }

    // Step 4: Re-sort events chronologically for each incident, and filter duplicate instances
    for (const incident of incidents) {
      const uniqueEvents: NormalizedEvent[] = [];
      const seenRaw = new Set<string>();
      for (const e of incident.events) {
        if (seenRaw.has(e.rawMessage)) continue;
        seenRaw.add(e.rawMessage);
        uniqueEvents.push(e);
      }
      incident.events = uniqueEvents.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    }

    if (unassociatedDealerEvents.length > 0) {
      this.logger.debug(
        `Found ${unassociatedDealerEvents.length} dealer events that could not be correlated.`,
      );
    }

    return incidents;
  }
}
