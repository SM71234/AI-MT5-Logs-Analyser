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
    const usedEvents = new Set<NormalizedEvent>();

    // 1. Identify all outcome/terminal events that complete an execution leg
    const outcomeEvents = sortedEvents.filter(
      (e) =>
        e.eventType === 'DEAL_EXECUTED' ||
        e.eventType === 'ORDER_FILLED' ||
        e.eventType === 'ORDER_REJECTED' ||
        e.eventType === 'ORDER_CANCELLED',
    );

    // Grouping by outcomes
    for (const outcome of outcomeEvents) {
      const login = outcome.login;
      const symbol = outcome.metadata.symbol || '';
      const action = outcome.metadata.action || 'BUY';
      const volume = outcome.metadata.volume || 0;
      
      const ticketId = outcome.metadata.ticket || outcome.metadata.dealId || outcome.metadata.orderId || '';
      const orderId = outcome.metadata.orderId;
      const dealId = outcome.metadata.dealId;

      const relatedEvents: NormalizedEvent[] = [outcome];
      usedEvents.add(outcome);

      const outcomeTime = new Date(outcome.timestamp).getTime();

      // Find other events matching by explicit IDs
      for (const e of sortedEvents) {
        if (usedEvents.has(e)) continue;

        let isMatch = false;

        // Match by Ticket/Position
        if (ticketId) {
          if (e.metadata.ticket === ticketId || e.metadata.orderId === ticketId || e.metadata.dealId === ticketId) {
            isMatch = true;
          }
        }

        // Match by Order ID
        if (orderId && (e.metadata.orderId === orderId || e.metadata.ticket === orderId)) {
          isMatch = true;
        }

        // Match by Deal ID
        if (dealId && (e.metadata.dealId === dealId || e.metadata.ticket === dealId)) {
          isMatch = true;
        }

        if (isMatch) {
          relatedEvents.push(e);
          usedEvents.add(e);
        }
      }

      // Proximity & semantic matching for requests/routing logs without IDs
      // Check for matching login, symbol, action, and occurred BEFORE outcome (within 15 seconds window)
      const proximityCandidates = sortedEvents.filter((e) => {
        if (usedEvents.has(e)) return false;
        if (e.login !== login && e.login !== '') return false; // allow blank login in dealer logs
        
        // Match symbol if defined
        if (e.metadata.symbol && e.metadata.symbol !== symbol) return false;

        // Match side (for close, action in close request might be opposite or same depending on log, so verify close ticket)
        if (e.metadata.action && e.metadata.action !== action && e.metadata.ticket !== ticketId) {
          // If it's a close request matching the ticket, action could be opposite (e.g. SELL to close BUY)
          if (e.metadata.ticket !== ticketId) return false;
        }

        const t = new Date(e.timestamp).getTime();
        return t <= outcomeTime && outcomeTime - t <= 15000;
      });

      // Filter to find the closest REQUEST/ROUTED sequence to avoid merging different attempts
      if (proximityCandidates.length > 0) {
        // Group candidate events that are contiguous/closest to the outcome
        for (const candidate of proximityCandidates) {
          relatedEvents.push(candidate);
          usedEvents.add(candidate);
        }
      }

      incidents.push({
        ticketId,
        login,
        symbol,
        action,
        volume,
        events: relatedEvents.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ),
      });
    }

    // 2. Identify incomplete request sequences (REQUEST or ROUTED that was never filled or rejected)
    const remainingRequests = sortedEvents.filter(
      (e) => !usedEvents.has(e) && (e.eventType === 'REQUEST' || e.eventType === 'ROUTED'),
    );

    for (const req of remainingRequests) {
      if (usedEvents.has(req)) continue;

      const login = req.login;
      const symbol = req.metadata.symbol || '';
      const action = req.metadata.action || 'BUY';
      const volume = req.metadata.volume || 0;
      const ticketId = req.metadata.ticket || req.metadata.orderId || '';

      const relatedEvents = [req];
      usedEvents.add(req);

      const reqTime = new Date(req.timestamp).getTime();

      // Find routing/acceptance events near this request
      const nearEvents = sortedEvents.filter((e) => {
        if (usedEvents.has(e)) return false;
        if (e.login !== login && e.login !== '') return false;
        if (e.metadata.symbol && e.metadata.symbol !== symbol) return false;

        const t = new Date(e.timestamp).getTime();
        return t >= reqTime && t - reqTime <= 15000;
      });

      for (const near of nearEvents) {
        relatedEvents.push(near);
        usedEvents.add(near);
      }

      incidents.push({
        ticketId,
        login,
        symbol,
        action,
        volume,
        events: relatedEvents.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ),
      });
    }

    return incidents;
  }
}
