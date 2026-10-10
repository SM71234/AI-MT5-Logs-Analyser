import { Injectable, Logger } from '@nestjs/common';
import { NormalizedEvent } from './normalization.engine';

export type CorrelationMethod =
  | 'EXACT_POSITION_ID'
  | 'EXACT_DEAL_ID'
  | 'EXACT_ORDER_ID'
  | 'EXPLICIT_REFERENCE'
  | 'REQUEST_ID'
  | 'SEMANTIC_MATCH'
  | 'PROXIMITY_FALLBACK'
  | 'UNRESOLVED';

export interface CorrelatedIncident {
  ticketId: string;
  login: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  volume: number;
  events: NormalizedEvent[];
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
export class CorrelationEngine {
  private readonly logger = new Logger('CorrelationEngine');

  correlate(events: NormalizedEvent[]): CorrelatedIncident[] {
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // 1. Build transitive identifier equivalence classes (excluding requestId)
    const idEquiv = new IdEquivalenceMap();
    for (const e of sortedEvents) {
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

    // 2. Identify all outcome/terminal events
    const terminalEvents = sortedEvents.filter(
      (e) =>
        e.eventType === 'DEAL_EXECUTED' ||
        e.eventType === 'ORDER_FILLED' ||
        e.eventType === 'ORDER_REJECTED' ||
        e.eventType === 'ORDER_CANCELLED',
    );

    // Group terminal events that represent the same physical execution leg (must share identifiers)
    const outcomeGroups: NormalizedEvent[][] = [];
    for (const outcome of terminalEvents) {
      const matchedGroup = outcomeGroups.find((group) => {
        // Unsuccessful attempts (REJECTED, CANCELLED) must NOT be grouped with successful executions (DEAL_EXECUTED, ORDER_FILLED)
        const isOutcomeSuccess = outcome.eventType === 'DEAL_EXECUTED' || outcome.eventType === 'ORDER_FILLED';
        const isGroupSuccess = group.some(e => e.eventType === 'DEAL_EXECUTED' || e.eventType === 'ORDER_FILLED');
        if (isOutcomeSuccess !== isGroupSuccess) {
          return false;
        }

        // Two distinct deals must remain separate execution legs
        const outcomeDealId = outcome.metadata.dealId;
        const groupDealIds = group.map(e => e.metadata.dealId).filter(Boolean);
        if (outcomeDealId && groupDealIds.length > 0 && !groupDealIds.includes(outcomeDealId)) {
          return false;
        }

        return group.some((e) => {
          // Check explicit ID matches
          const ids1 = [outcome.metadata.positionId, outcome.metadata.orderId, outcome.metadata.dealId, outcome.metadata.ticketId].filter(Boolean);
          const ids2 = [e.metadata.positionId, e.metadata.orderId, e.metadata.dealId, e.metadata.ticketId].filter(Boolean);
          const hasIdMatch = ids1.some(id1 => ids2.some(id2 => id1 === id2 || idEquiv.areEquivalent(id1!, id2!)));
          return hasIdMatch;
        });
      });

      if (matchedGroup) {
        matchedGroup.push(outcome);
      } else {
        outcomeGroups.push([outcome]);
      }
    }

    // 3. Separate non-terminal events (potential candidates for outcomes)
    const nonTerminalEvents = sortedEvents.filter((e) => !terminalEvents.includes(e));

    // For each candidate non-terminal event, calculate match score/method against every outcome group
    interface MatchResult {
      groupIndex: number;
      score: number;
      method: CorrelationMethod;
      evidence: string;
    }

    const candidateMatches = new Map<NormalizedEvent, MatchResult[]>();

    for (const candidate of nonTerminalEvents) {
      const matchesForCandidate: MatchResult[] = [];

      for (let gIndex = 0; gIndex < outcomeGroups.length; gIndex++) {
        const group = outcomeGroups[gIndex];
        const earliestT = Math.min(...group.map(e => new Date(e.timestamp).getTime()));

        const cTime = new Date(candidate.timestamp).getTime();
        // Strict chronological validation
        if (cTime > earliestT + 50) {
          continue;
        }

        // Extract outcome group unified IDs
        const gPosIds = new Set(group.map(e => e.metadata.positionId).filter(Boolean));
        const gDealIds = new Set(group.map(e => e.metadata.dealId).filter(Boolean));
        const gOrderIds = new Set(group.map(e => e.metadata.orderId).filter(Boolean));
        const gRequestIds = new Set(group.map(e => e.metadata.requestId).filter(Boolean));
        const gTicketIds = new Set(group.map(e => e.metadata.ticketId).filter(Boolean));

        const cPos = candidate.metadata.positionId;
        const cDeal = candidate.metadata.dealId;
        const cOrder = candidate.metadata.orderId;
        const cReq = candidate.metadata.requestId;
        const cTicket = candidate.metadata.ticketId;

        // Block conflicting identifier matches
        let hasConflict = false;
        if (cPos && gPosIds.size > 0 && !gPosIds.has(cPos)) {
          if (![...gPosIds].some(gid => idEquiv.areEquivalent(cPos, gid!))) {
            hasConflict = true;
          }
        }
        if (cDeal && gDealIds.size > 0 && !gDealIds.has(cDeal)) {
          if (![...gDealIds].some(gid => idEquiv.areEquivalent(cDeal, gid!))) {
            hasConflict = true;
          }
        }
        if (cOrder && gOrderIds.size > 0 && !gOrderIds.has(cOrder)) {
          if (![...gOrderIds].some(gid => idEquiv.areEquivalent(cOrder, gid!))) {
            hasConflict = true;
          }
        }
        if (cReq && gRequestIds.size > 0 && !gRequestIds.has(cReq)) {
          hasConflict = true;
        }
        if (cTicket && gTicketIds.size > 0 && !gTicketIds.has(cTicket)) {
          const isCDeal = !!(cDeal && cTicket === cDeal);
          const hasGDeal = [...gTicketIds].some(gid => gDealIds.has(gid));
          if (!isCDeal && !hasGDeal) {
            if (![...gTicketIds].some(gid => idEquiv.areEquivalent(cTicket, gid!))) {
              hasConflict = true;
            }
          }
        }

        if (hasConflict) {
          continue;
        }

        // Priority 1: Exact PositionID
        if (cPos && gPosIds.has(cPos)) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 100,
            method: 'EXACT_POSITION_ID',
            evidence: `Exact Position ID match on '${cPos}'`
          });
          continue;
        }

        // Priority 2: Exact DealID
        if (cDeal && gDealIds.has(cDeal)) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 100,
            method: 'EXACT_DEAL_ID',
            evidence: `Exact Deal ID match on '${cDeal}'`
          });
          continue;
        }

        // Priority 3: Exact OrderID
        if (cOrder && gOrderIds.has(cOrder)) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 100,
            method: 'EXACT_ORDER_ID',
            evidence: `Exact Order ID match on '${cOrder}'`
          });
          continue;
        }

        // Priority 4: Explicit Reference Relationship (transitive IDs equivalence check)
        const cIds = [cPos, cDeal, cOrder, cTicket].filter(Boolean);
        const gIds = [...gPosIds, ...gDealIds, ...gOrderIds, ...gTicketIds];
        const hasTransitiveMatch = cIds.some(cid => gIds.some(gid => idEquiv.areEquivalent(cid!, gid!)));
        if (hasTransitiveMatch) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 80,
            method: 'EXPLICIT_REFERENCE',
            evidence: `Transitively linked via explicit identifier reference class`
          });
          continue;
        }

        // Priority 5: RequestID
        if (cReq && gRequestIds.has(cReq)) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 70,
            method: 'REQUEST_ID',
            evidence: `Request ID match on '${cReq}'`
          });
          continue;
        }

        // Priority 6: Semantic Match
        const loginMatch = candidate.login === group[0].login || candidate.login === '';
        const symbolMatch = !candidate.metadata.symbol || !group[0].metadata.symbol || candidate.metadata.symbol === group[0].metadata.symbol;
        const volumeMatch = !candidate.metadata.volume || !group[0].metadata.volume || candidate.metadata.volume === group[0].metadata.volume;
        
        let actionMatch = false;
        if (!candidate.metadata.action || !group[0].metadata.action) {
          actionMatch = true;
        } else if (candidate.metadata.action === group[0].metadata.action) {
          actionMatch = true;
        } else if (candidate.metadata.positionId && gPosIds.has(candidate.metadata.positionId)) {
          actionMatch = true;
        } else if (candidate.metadata.ticket && gPosIds.has(candidate.metadata.ticket)) {
          actionMatch = true;
        }

        const timeDiff = earliestT - cTime;

        if (loginMatch && symbolMatch && actionMatch && volumeMatch && timeDiff <= 15000 && timeDiff >= 0) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 40,
            method: 'SEMANTIC_MATCH',
            evidence: `Semantic match: login (${candidate.login}), symbol (${candidate.metadata.symbol || 'N/A'}), action (${candidate.metadata.action || 'N/A'}), volume (${candidate.metadata.volume || 'N/A'}) within 15s`
          });
          continue;
        }

        // Priority 7: Proximity Fallback
        if (loginMatch && symbolMatch && actionMatch && timeDiff <= 15000 && timeDiff >= 0) {
          matchesForCandidate.push({
            groupIndex: gIndex,
            score: 10,
            method: 'PROXIMITY_FALLBACK',
            evidence: `Proximity fallback match: login (${candidate.login}), symbol (${candidate.metadata.symbol || 'N/A'}) within 15s`
          });
        }
      }

      if (matchesForCandidate.length > 0) {
        candidateMatches.set(candidate, matchesForCandidate);
      }
    }

    // Resolve assignments and identify ambiguity
    const groupAssignments = new Map<number, { event: NormalizedEvent; match: MatchResult }[]>();

    for (const [candidate, matches] of candidateMatches.entries()) {
      const highestScore = Math.max(...matches.map(m => m.score));
      const bestMatches = matches.filter(m => m.score === highestScore);

      if (bestMatches.length > 1) {
        // Calculate positive time differences for all best matches
        const matchesWithDiff = bestMatches.map(match => {
          const group = outcomeGroups[match.groupIndex];
          const earliestT = Math.min(...group.map(e => new Date(e.timestamp).getTime()));
          const cTime = new Date(candidate.timestamp).getTime();
          const diff = earliestT - cTime;
          return { match, diff };
        }).filter(m => m.diff >= 0);

        // Sort by time difference ascending
        matchesWithDiff.sort((a, b) => a.diff - b.diff);

        // We resolve by proximity ONLY if:
        // 1. We have at least one match with a positive difference.
        // 2. The closest match is significantly closer than the second closest match (threshold: 2000 ms).
        let resolvedMatch: MatchResult | null = null;
        if (matchesWithDiff.length === 1) {
          resolvedMatch = matchesWithDiff[0].match;
        } else if (matchesWithDiff.length > 1) {
          const closest = matchesWithDiff[0];
          const secondClosest = matchesWithDiff[1];
          if (secondClosest.diff - closest.diff >= 2000) {
            resolvedMatch = closest.match;
          }
        }

        if (resolvedMatch) {
          const list = groupAssignments.get(resolvedMatch.groupIndex) || [];
          list.push({ event: candidate, match: resolvedMatch });
          groupAssignments.set(resolvedMatch.groupIndex, list);
        } else {
          // Fallback to ambiguous unresolved state
          for (const match of bestMatches) {
            const list = groupAssignments.get(match.groupIndex) || [];
            list.push({
              event: candidate,
              match: {
                ...match,
                score: 0,
                method: 'UNRESOLVED',
                evidence: `Ambiguous match: matches multiple outcome lifecycles (groups ${bestMatches.map(m => m.groupIndex).join(', ')}) with score ${highestScore}`
              }
            });
            groupAssignments.set(match.groupIndex, list);
          }
        }
      } else {
        const match = bestMatches[0];
        const list = groupAssignments.get(match.groupIndex) || [];
        list.push({ event: candidate, match });
        groupAssignments.set(match.groupIndex, list);
      }
    }

    // 4. Construct final CorrelatedIncidents for each outcome group
    const incidents: CorrelatedIncident[] = [];
    const usedEvents = new Set<NormalizedEvent>();

    for (let gIndex = 0; gIndex < outcomeGroups.length; gIndex++) {
      const outcomeGroup = outcomeGroups[gIndex];
      const assignments = groupAssignments.get(gIndex) || [];

      const incidentEvents = [...outcomeGroup, ...assignments.map(a => a.event)].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      outcomeGroup.forEach(e => usedEvents.add(e));
      assignments.forEach(a => usedEvents.add(a.event));

      const login = outcomeGroup[0].login;
      const symbol = outcomeGroup[0].metadata.symbol || '';
      const action = outcomeGroup[0].metadata.action || 'BUY';
      const volume = outcomeGroup[0].metadata.volume || 0;
      
      const ticketId = incidentEvents.map(e => e.metadata.positionId || e.metadata.ticketId || e.metadata.orderId || e.metadata.dealId).find(Boolean) || '';

      let finalMethod: CorrelationMethod = 'EXACT_DEAL_ID';
      let finalScore = 100;
      const evidenceList: string[] = [];

      const resolvedAssignments = assignments.filter(a => a.match.method !== 'UNRESOLVED');
      const unresolvedAssignments = assignments.filter(a => a.match.method === 'UNRESOLVED');

      if (unresolvedAssignments.length > 0) {
        finalMethod = 'UNRESOLVED';
        finalScore = 0;
        evidenceList.push(`Correlation marked UNRESOLVED due to ambiguous event matches.`);
        unresolvedAssignments.forEach(u => evidenceList.push(u.match.evidence));
      } else if (resolvedAssignments.length > 0) {
        // Overall correlation method is determined by the weakest link (minimum score)
        const sortedAssignments = [...resolvedAssignments].sort((a, b) => a.match.score - b.match.score);
        finalMethod = sortedAssignments[0].match.method;
        finalScore = sortedAssignments[0].match.score;
        
        evidenceList.push(`Successfully correlated ${resolvedAssignments.length} events.`);
        resolvedAssignments.forEach(a => {
          evidenceList.push(`[${a.match.method}] ${a.match.evidence}`);
        });
      } else {
        const hasIds = outcomeGroup.some(e => e.metadata.positionId || e.metadata.dealId || e.metadata.orderId);
        finalMethod = hasIds ? 'EXACT_DEAL_ID' : 'SEMANTIC_MATCH';
        finalScore = hasIds ? 100 : 40;
        evidenceList.push(`Anchor outcome event created incident. No matching preceding requests found.`);
      }

      incidents.push({
        ticketId,
        login,
        symbol,
        action,
        volume,
        events: incidentEvents,
        correlationMethod: finalMethod,
        correlationEvidence: evidenceList,
        correlationScore: finalScore
      });
    }

    // 5. Group remaining request sequences that were not matched (incomplete requests)
    const remainingRequests = sortedEvents.filter(
      (e) => !usedEvents.has(e) && (e.eventType === 'REQUEST' || e.eventType === 'ROUTED')
    );

    const reqGroups: NormalizedEvent[][] = [];
    for (const req of remainingRequests) {
      const matchedGroup = reqGroups.find(group => {
        return group.some(e => {
          const ids1 = [req.metadata.positionId, req.metadata.orderId, req.metadata.dealId, req.metadata.ticketId, req.metadata.requestId].filter(Boolean);
          const ids2 = [e.metadata.positionId, e.metadata.orderId, e.metadata.dealId, e.metadata.ticketId, e.metadata.requestId].filter(Boolean);
          const hasIdMatch = ids1.some(id1 => ids2.some(id2 => id1 === id2 || idEquiv.areEquivalent(id1!, id2!)));
          if (hasIdMatch) return true;

          const sameSemantic =
            req.login === e.login &&
            req.metadata.symbol === e.metadata.symbol &&
            req.metadata.action === e.metadata.action &&
            req.metadata.volume === e.metadata.volume;
          const timeDiff = Math.abs(new Date(req.timestamp).getTime() - new Date(e.timestamp).getTime());
          return sameSemantic && timeDiff <= 15000;
        });
      });

      if (matchedGroup) {
        matchedGroup.push(req);
      } else {
        reqGroups.push([req]);
      }
    }

    for (const reqGroup of reqGroups) {
      const sortedGroup = reqGroup.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const login = sortedGroup[0].login;
      const symbol = sortedGroup[0].metadata.symbol || '';
      const action = sortedGroup[0].metadata.action || 'BUY';
      const volume = sortedGroup[0].metadata.volume || 0;
      
      const ticketId = sortedGroup.map(e => e.metadata.positionId || e.metadata.dealId || e.metadata.orderId || e.metadata.ticketId).find(Boolean) || '';

      incidents.push({
        ticketId,
        login,
        symbol,
        action,
        volume,
        events: sortedGroup,
        correlationMethod: 'UNRESOLVED',
        correlationEvidence: [`Incomplete request sequence: request was routed but never filled or rejected.`],
        correlationScore: 0
      });
    }

    return incidents.sort(
      (a, b) => {
        const timeA = a.events.length > 0 ? new Date(a.events[0].timestamp).getTime() : 0;
        const timeB = b.events.length > 0 ? new Date(b.events[0].timestamp).getTime() : 0;
        return timeA - timeB;
      }
    );
  }
}
