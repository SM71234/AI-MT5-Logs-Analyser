import { Injectable, Logger } from '@nestjs/common';
import { NormalizedEvent } from './normalization.engine';
import { CorrelationEngine, CorrelatedIncident, CorrelationMethod } from './correlation.engine';

export type PositionLifecycleStatus =
  | 'OPEN'
  | 'PARTIALLY_CLOSED'
  | 'CLOSED'
  | 'REVERSED'
  | 'UNKNOWN'
  | 'INCOMPLETE'
  | 'AMBIGUOUS';

export interface PositionLedger {
  positionId: string;
  login: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  originalVolume: number;
  currentVolume: number;
  closedVolume: number;
  
  entryDeals: CorrelatedIncident[];
  exitDeals: CorrelatedIncident[];
  reversalDeals: CorrelatedIncident[];
  
  weightedAverageEntryPrice: number | null;
  weightedAverageExitPrice: number | null;
  
  realizedProfit: number;
  commission: number;
  swap: number;
  fee: number;
  netProfit: number;
  
  lifecycleStatus: PositionLifecycleStatus;
  
  correlationMethod?: CorrelationMethod;
  correlationEvidence?: string[];
  correlationScore?: number;
}

class IdEquivalenceMap {
  private parent = new Map<string, string>();

  find(id: string): string {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
    }
    let root = id;
    while (root !== this.parent.get(root)) {
      root = this.parent.get(root)!;
    }
    let curr = id;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(id1: string, id2: string): void {
    const root1 = this.find(id1);
    const root2 = this.find(id2);
    if (root1 !== root2) {
      this.parent.set(root1, root2);
    }
  }

  areEquivalent(id1: string, id2: string): boolean {
    return this.find(id1) === this.find(id2);
  }
}

@Injectable()
export class PositionLedgerService {
  private readonly logger = new Logger('PositionLedgerService');

  reconstructPositions(incidents: CorrelatedIncident[], trades?: any[]): PositionLedger[] {
    // 1. Build transitive identifier equivalence classes across all events in all incidents
    const idEquiv = new IdEquivalenceMap();

    if (trades && Array.isArray(trades)) {
      for (const t of trades) {
        const ids = [
          t.positionId,
          t.ticket,
          t.entry?.dealId,
          t.entry?.orderId,
          t.exit?.dealId,
          t.exit?.orderId
        ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
        for (let i = 0; i < ids.length - 1; i++) {
          idEquiv.union(ids[i], ids[i + 1]);
        }
      }
    }

    for (const incident of incidents) {
      for (const e of incident.events) {
        const ids = [
          e.metadata.positionId,
          e.metadata.orderId,
          e.metadata.dealId,
          e.metadata.ticketId
        ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

        for (let i = 0; i < ids.length - 1; i++) {
          idEquiv.union(ids[i], ids[i + 1]);
        }
      }
    }

    // 2. Group incidents by their resolved position ID
    const positionGroups = new Map<string, CorrelatedIncident[]>();
    for (const incident of incidents) {
      const ids = incident.events.flatMap(e => [
        e.metadata.positionId,
        e.metadata.orderId,
        e.metadata.dealId,
        e.metadata.ticketId
      ]).filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      // Find the representative position ID root
      let posId = incident.ticketId;
      if (ids.length > 0) {
        posId = idEquiv.find(ids[0]);
      }

      const group = positionGroups.get(posId) || [];
      group.push(incident);
      positionGroups.set(posId, group);
    }

    const ledgers: PositionLedger[] = [];

    // 3. Process each group to build its position ledger
    for (const [positionId, groupIncidents] of positionGroups.entries()) {
      // Sort incidents chronologically based on their earliest event timestamp
      const sortedIncidents = [...groupIncidents].sort((a, b) => {
        const timeA = Math.min(...a.events.map(e => new Date(e.timestamp).getTime()));
        const timeB = Math.min(...b.events.map(e => new Date(e.timestamp).getTime()));
        return timeA - timeB;
      });

      let side: 'BUY' | 'SELL' = 'BUY';
      let sideEstablished = false;

      let currentVolume = 0;
      let closedVolume = 0;

      const entryDeals: CorrelatedIncident[] = [];
      const exitDeals: CorrelatedIncident[] = [];
      const reversalDeals: CorrelatedIncident[] = [];

      let sumEntryPriceVolume = 0;
      let sumEntryVolume = 0;

      let sumExitPriceVolume = 0;
      let sumExitVolume = 0;

      let realizedProfit = 0;
      let commission = 0;
      let swap = 0;
      let fee = 0;

      let hasUnresolved = false;
      const evidenceList: string[] = [];
      const scoreList: number[] = [];
      const methodList: CorrelationMethod[] = [];
      
      const processedDealIds = new Set<string>();

      for (const incident of sortedIncidents) {
        // Collect correlation tracing metadata
        if (incident.correlationMethod) {
          methodList.push(incident.correlationMethod);
        }
        if (incident.correlationScore !== undefined) {
          scoreList.push(incident.correlationScore);
        }
        if (incident.correlationEvidence) {
          evidenceList.push(...incident.correlationEvidence);
        }

        if (incident.correlationMethod === 'UNRESOLVED') {
          hasUnresolved = true;
        }

        // Find the execution event (deal or order filled)
        const dealEvent = incident.events.find(
          (e) => e.eventType === 'DEAL_EXECUTED' || e.eventType === 'ORDER_FILLED'
        );

        if (!dealEvent) {
          // Non-executed request leg
          const lastEvent = incident.events[incident.events.length - 1];
          if (lastEvent) {
            commission += lastEvent.metadata.commission || 0;
            swap += lastEvent.metadata.swap || 0;
            fee += lastEvent.metadata.fee || 0;
          }
          continue;
        }

        const dealId = dealEvent.metadata.dealId || incident.ticketId;
        if (dealId) {
          if (processedDealIds.has(dealId)) {
            // Skip duplicate outcome to prevent double counting
            continue;
          }
          processedDealIds.add(dealId);
        }

        const dealPrice = dealEvent.metadata.priceExecuted;
        const dealVolume = incident.volume || dealEvent.metadata.volume || 0;
        const dealAction = incident.action || dealEvent.metadata.action || 'BUY';

        commission += dealEvent.metadata.commission || 0;
        swap += dealEvent.metadata.swap || 0;
        fee += dealEvent.metadata.fee || 0;
        realizedProfit += dealEvent.metadata.profit || 0;

        let explicitEntry: 'IN' | 'OUT' | 'INOUT' | null = null;
        const rawUpper = dealEvent.rawMessage.toUpperCase();
        if (rawUpper.includes('ENTRY_INOUT') || rawUpper.includes('ENTRY INOUT')) {
          explicitEntry = 'INOUT';
        } else if (rawUpper.includes('ENTRY_IN') || rawUpper.includes('ENTRY IN')) {
          explicitEntry = 'IN';
        } else if (rawUpper.includes('ENTRY_OUT') || rawUpper.includes('ENTRY OUT') || rawUpper.includes('CLOSE')) {
          explicitEntry = 'OUT';
        }

        // Handle missing entry event detection
        let isFirstDealExit = false;
        if (!sideEstablished) {
          if (explicitEntry === 'OUT' || dealEvent.rawMessage.toLowerCase().includes('close')) {
            isFirstDealExit = true;
            side = dealAction === 'BUY' ? 'SELL' : 'BUY';
            sideEstablished = true;
          }
        }

        if (!sideEstablished) {
          side = dealAction;
          sideEstablished = true;
        }

        const isSameSide = dealAction === side;
        const isReversal = explicitEntry === 'INOUT' || (!isSameSide && dealVolume > currentVolume && currentVolume > 0 && !isFirstDealExit);

        if (isReversal) {
          reversalDeals.push(incident);

          const closePartVol = currentVolume;
          const openPartVol = parseFloat((dealVolume - currentVolume).toFixed(2));

          if (dealPrice !== undefined && dealPrice !== null) {
            sumExitPriceVolume += dealPrice * closePartVol;
            sumExitVolume = parseFloat((sumExitVolume + closePartVol).toFixed(2));
            sumEntryPriceVolume = dealPrice * openPartVol;
            sumEntryVolume = openPartVol;
          }
          closedVolume = parseFloat((closedVolume + closePartVol).toFixed(2));

          // Reversal shifts side and updates remaining exposure
          side = side === 'BUY' ? 'SELL' : 'BUY';
          currentVolume = openPartVol;
        } else if (isFirstDealExit) {
          // Missing entry leg: first deal is explicitly exit
          exitDeals.push(incident);
          closedVolume = parseFloat((closedVolume + dealVolume).toFixed(2));
          if (dealPrice !== undefined && dealPrice !== null) {
            sumExitPriceVolume += dealPrice * dealVolume;
            sumExitVolume = parseFloat((sumExitVolume + dealVolume).toFixed(2));
          }
        } else if (isSameSide || explicitEntry === 'IN') {
          // Normal entry (ENTRY_IN) or scale-in
          entryDeals.push(incident);
          currentVolume = parseFloat((currentVolume + dealVolume).toFixed(2));

          if (dealPrice !== undefined && dealPrice !== null) {
            sumEntryPriceVolume += dealPrice * dealVolume;
            sumEntryVolume = parseFloat((sumEntryVolume + dealVolume).toFixed(2));
          }
        } else {
          // Normal exit (ENTRY_OUT) or scale-out
          exitDeals.push(incident);
          closedVolume = parseFloat((closedVolume + dealVolume).toFixed(2));
          currentVolume = Math.max(0, parseFloat((currentVolume - dealVolume).toFixed(2)));

          if (dealPrice !== undefined && dealPrice !== null) {
            sumExitPriceVolume += dealPrice * dealVolume;
            sumExitVolume = parseFloat((sumExitVolume + dealVolume).toFixed(2));
          }
        }
      }

      // Calculate originalVolume as sum of entryDeals volumes
      const originalVolume = parseFloat(entryDeals.reduce((sum, d) => sum + (d.volume || 0), 0).toFixed(2));

      // Calculate weighted averages
      const weightedAverageEntryPrice = sumEntryVolume > 0 
        ? parseFloat((sumEntryPriceVolume / sumEntryVolume).toFixed(5)) 
        : null;
      const weightedAverageExitPrice = sumExitVolume > 0 
        ? parseFloat((sumExitPriceVolume / sumExitVolume).toFixed(5)) 
        : null;

      // Determine lifecycle status deterministically
      let lifecycleStatus: PositionLifecycleStatus = 'UNKNOWN';
      if (hasUnresolved) {
        lifecycleStatus = 'AMBIGUOUS';
      } else if (originalVolume === 0 && closedVolume > 0) {
        lifecycleStatus = 'INCOMPLETE';
      } else if (originalVolume > 0 && closedVolume === 0) {
        lifecycleStatus = 'OPEN';
      } else if (originalVolume > 0 && currentVolume > 0) {
        lifecycleStatus = 'PARTIALLY_CLOSED';
      } else if (originalVolume > 0 && currentVolume === 0) {
        lifecycleStatus = 'CLOSED';
      }

      if (reversalDeals.length > 0 && currentVolume > 0) {
        lifecycleStatus = 'REVERSED';
      }

      // Financial math
      const netProfit = realizedProfit + commission + swap + fee;

      // Overall correlation stats representing the weakest link (minimum score)
      const minScore = scoreList.length > 0 ? Math.min(...scoreList) : 100;
      let finalMethod: CorrelationMethod = 'EXACT_DEAL_ID';
      if (hasUnresolved) {
        finalMethod = 'UNRESOLVED';
      } else if (methodList.length > 0) {
        // Use weakest method
        const methodScores: Record<CorrelationMethod, number> = {
          EXACT_POSITION_ID: 100,
          EXACT_DEAL_ID: 100,
          EXACT_ORDER_ID: 100,
          EXPLICIT_REFERENCE: 80,
          REQUEST_ID: 70,
          SEMANTIC_MATCH: 40,
          PROXIMITY_FALLBACK: 10,
          UNRESOLVED: 0,
        };
        const sortedMethods = [...methodList].sort((a, b) => methodScores[a] - methodScores[b]);
        finalMethod = sortedMethods[0];
      }

      let canonicalPosId = positionId;
      if (trades && Array.isArray(trades)) {
        for (const t of trades) {
          const tPos = t.positionId || t.ticket;
          if (tPos && idEquiv.areEquivalent(String(tPos), positionId)) {
            canonicalPosId = String(tPos);
            break;
          }
        }
      }
      if (canonicalPosId === positionId) {
        for (const inc of groupIncidents) {
          for (const ev of inc.events) {
            if (ev.metadata.positionId) {
              canonicalPosId = ev.metadata.positionId;
              break;
            }
          }
          if (canonicalPosId !== positionId) break;
        }
      }

      const login = groupIncidents[0]?.login || '';
      const symbol = groupIncidents[0]?.symbol || '';

      ledgers.push({
        positionId: canonicalPosId,
        login,
        symbol,
        side,
        originalVolume: parseFloat(originalVolume.toFixed(2)),
        currentVolume: parseFloat(currentVolume.toFixed(2)),
        closedVolume: parseFloat(closedVolume.toFixed(2)),
        entryDeals,
        exitDeals,
        reversalDeals,
        weightedAverageEntryPrice,
        weightedAverageExitPrice,
        realizedProfit: parseFloat(realizedProfit.toFixed(2)),
        commission: parseFloat(commission.toFixed(2)),
        swap: parseFloat(swap.toFixed(2)),
        fee: parseFloat(fee.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2)),
        lifecycleStatus,
        correlationMethod: finalMethod,
        correlationEvidence: [...new Set(evidenceList)],
        correlationScore: hasUnresolved ? 0 : minScore
      });
    }

    return ledgers.sort(
      (a, b) => {
        const timeA = a.entryDeals.length > 0 
          ? Math.min(...a.entryDeals.flatMap(d => d.events.map(e => new Date(e.timestamp).getTime()))) 
          : 0;
        const timeB = b.entryDeals.length > 0 
          ? Math.min(...b.entryDeals.flatMap(d => d.events.map(e => new Date(e.timestamp).getTime()))) 
          : 0;
        return timeA - timeB;
      }
    );
  }
}
