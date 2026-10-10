import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Database, User, Calendar, Activity, 
  Clock, AlertTriangle, MessageSquare, 
  Send, Plus, FileText, CheckCircle, XCircle,
  TrendingUp, AlertCircle
} from 'lucide-react';

interface Note {
  id: string;
  content: string;
  createdAt: string;
  user: { name: string; role: string };
}

interface AiReport {
  id: string;
  analysisType: string;
  response: string;
  createdAt: string;
}

interface NormalizedEvent {
  timestamp: string;
  eventType: string;
  rawMessage: string;
  metadata: Record<string, any>;
}

interface InvestigationCase {
  id: string;
  ticketId: string;
  clientLogin: string;
  title: string;
  status: string;
  createdAt: string;
  metrics: any;
  events: NormalizedEvent[];
  broker: { name: string };
  user: { name: string };
  notes: Note[];
  aiReports: AiReport[];
  recalculationFailed?: boolean;
}

export default function InvestigationWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'timeline' | 'metrics' | 'ai' | 'notes'>('timeline');
  const [noteContent, setNoteContent] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [selectedEvidence, setSelectedEvidence] = useState<{ claim: string; rawLog: string; timestamp: string } | null>(null);

  // Fetch detailed investigation case details
  const { data: caseFile, isLoading, error } = useQuery<InvestigationCase>({
    queryKey: ['investigation-details', id],
    queryFn: async () => {
      const res = await fetch(`/api/v1/investigations/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to load investigation details');
      const body = await res.json();
      return body.data;
    },
    enabled: !!id,
  });

  // Notes addition mutation
  const noteMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/v1/investigations/${id}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('Failed to add note');
      const body = await res.json();
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-details', id] });
      setNoteContent('');
    },
  });

  // AI completions mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/investigations/${id}/analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to run AI analysis');
      const body = await res.json();
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investigation-details', id] });
    },
  });

  // AI chat follow-up mutation
  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`/api/v1/investigations/${id}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message,
          chatHistory: chatMessages,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'AI Chat failed');
      return body.data.answer;
    },
    onSuccess: (answer) => {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    },
  });

  const getSuggestedQuestions = () => {
    const isRejected = metrics?.canonicalResult?.status === 'REJECTED';
    if (isRejected) {
      return [
        'Why was this trade rejected?',
        'What happened between request and execution?',
        'How long did the dealer take?',
        'Show me the trade lifecycle.',
      ];
    } else {
      return [
        'Why did this trade get this slippage?',
        'What happened between request and execution?',
        'How long did the dealer take?',
        'What price was requested vs executed?',
        'Show me the trade lifecycle.',
      ];
    }
  };

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    noteMutation.mutate(noteContent.trim());
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatMutation.isPending) return;

    const userMsg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setChatInput('');
    chatMutation.mutate(userMsg);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-800 border-t-zinc-300" />
          <span className="text-xs">Loading case workspace...</span>
        </div>
      </div>
    );
  }

  if (error || !caseFile) {
    return (
      <div className="p-8 text-center text-zinc-500 text-xs">
        Failed to load investigation details. Profile may be invalid.
      </div>
    );
  }

  const latestAiReport = caseFile.aiReports?.[0];
  const metrics = caseFile.metrics;

  return (
    <div className="relative z-10 flex-1 flex flex-col h-full overflow-hidden bg-zinc-950">
      
      {/* Top Header details */}
      <header className="border-b border-zinc-900 bg-zinc-950/40 px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/investigations')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900/20 text-zinc-400 hover:text-zinc-100 transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-100">{caseFile.title}</h2>
              <span className={`inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-0.5 text-[9px] font-mono border ${
                caseFile.status === 'OPEN'
                  ? 'border-amber-950 text-amber-400 bg-amber-950/10'
                  : 'border-emerald-950 text-emerald-400 bg-emerald-950/10'
              }`}>
                {caseFile.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Database className="h-3.5 w-3.5" />
                {caseFile.broker?.name}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                Client: {caseFile.clientLogin}
              </span>
              <span>•</span>
              <span className="font-mono">Ticket: #{caseFile.ticketId}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <Calendar className="h-4 w-4" />
          <span>Case Created: {new Date(caseFile.createdAt).toLocaleDateString()}</span>
        </div>
      </header>

      {/* Top Action Bar */}
      <div className="border-b border-zinc-900 bg-zinc-950/20 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Trade Investigation
        </div>
        <button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          className="rounded-lg px-4 py-2 text-xs font-semibold transition bg-zinc-100 text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analyzeMutation.isPending
            ? 'Generating Investigation...'
            : analyzeMutation.isError
            ? 'Retry AI Audit Report'
            : latestAiReport
            ? 'Regenerate AI Audit Report'
            : 'Generate AI Audit Report'}
        </button>
      </div>

      {/* Recalculation Stale Warning Banner */}
      {caseFile.recalculationFailed && (
        <div className="mx-6 mt-4 p-4 rounded-xl border border-amber-950/60 bg-amber-950/15 text-amber-400 flex items-start gap-4">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wider font-semibold">Warning: Recalculation Offline</h5>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              The MT5 server connector is currently offline or unreachable. Dynamic log recalculation failed. Serving cached metrics from the database instead.
            </p>
          </div>
        </div>
      )}

      {/* Investigation Conclusion Banner */}
      {metrics?.canonicalResult && (
        <div className={`mx-6 mt-4 p-4 rounded-xl border flex items-start gap-4 ${
          metrics.canonicalResult.status === 'EXECUTED'
            ? 'border-emerald-950/60 bg-emerald-950/15 text-emerald-400'
            : metrics.canonicalResult.status === 'REJECTED'
            ? 'border-red-950/60 bg-red-950/15 text-red-400'
            : 'border-zinc-800 bg-zinc-900/40 text-zinc-400'
        }`}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                metrics.canonicalResult.status === 'EXECUTED'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : metrics.canonicalResult.status === 'REJECTED'
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
              }`}>
                {metrics.canonicalResult.status}
              </span>
              <h4 className="text-xs font-semibold text-zinc-200">Investigation Conclusion</h4>
            </div>
            <p className="text-xs mt-1.5 text-zinc-450 leading-relaxed">
              {metrics.canonicalResult.status === 'EXECUTED' && (
                <>
                  The trade request for <strong>{metrics.canonicalResult.trade.volume} Lot {metrics.canonicalResult.trade.symbol}</strong> was successfully executed at price <strong>{metrics.canonicalResult.execution.executionPrice}</strong>.
                  {metrics.exit ? (
                    <>
                      {' '}Open execution time was <strong>{metrics.entry?.totalObservableExecutionTimeMs !== null && metrics.entry?.totalObservableExecutionTimeMs !== undefined ? `${metrics.entry.totalObservableExecutionTimeMs.toFixed(0)} ms` : 'N/A'}</strong>, and Close execution time was <strong>{metrics.exit?.totalObservableExecutionTimeMs !== null && metrics.exit?.totalObservableExecutionTimeMs !== undefined ? `${metrics.exit.totalObservableExecutionTimeMs.toFixed(0)} ms` : 'N/A'}</strong>
                    </>
                  ) : (
                    <>
                      {' '}Execution time was <strong>{metrics.entry?.totalObservableExecutionTimeMs !== null && metrics.entry?.totalObservableExecutionTimeMs !== undefined ? `${metrics.entry.totalObservableExecutionTimeMs.toFixed(0)} ms` : 'N/A'}</strong>
                    </>
                  )}
                  {' '}with <strong>{metrics.summary?.netSlippage ? `${metrics.summary.netSlippage.slippagePoints} points ${metrics.summary.netSlippage.slippageType}` : 'no'}</strong> slippage.
                </>
              )}
              {metrics.canonicalResult.status === 'REJECTED' && (
                <>
                  The trade request was explicitly rejected during the <strong>{metrics.entry?.rejection?.failedStage || 'execution'}</strong> stage by <strong>{metrics.entry?.rejection?.rejectedBy || 'the system'}</strong> due to: <strong>"{metrics.entry?.rejection?.reason || 'unknown'}"</strong>.
                </>
              )}
              {metrics.canonicalResult.status === 'INCOMPLETE' && (
                <>
                  The trade request submission was started, but the logs terminate abruptly without any execution or explicit rejection events.
                </>
              )}
              {metrics.canonicalResult.status === 'UNKNOWN' && (
                <>
                  The trade dispute timeline could not be resolved from the available journal records.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="border-b border-zinc-900 bg-zinc-950/20 px-6 shrink-0 flex overflow-x-auto scrollbar-none whitespace-nowrap">
        <button
          onClick={() => setActiveTab('timeline')}
          className={`px-4 py-3 text-xs font-semibold border-b-2 transition duration-150 ${
            activeTab === 'timeline'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-350'
          }`}
        >
          Timeline & Logs
        </button>
        <button
          onClick={() => setActiveTab('metrics')}
          className={`px-4 py-3 text-xs font-semibold border-b-2 transition duration-150 ${
            activeTab === 'metrics'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-350'
          }`}
        >
          Calculated Metrics
        </button>
        <button
          onClick={() => setActiveTab('ai')}
          className={`px-4 py-3 text-xs font-semibold border-b-2 transition duration-150 ${
            activeTab === 'ai'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-350'
          }`}
        >
          AI Audit Report
        </button>
        <button
          onClick={() => setActiveTab('notes')}
          className={`px-4 py-3 text-xs font-semibold border-b-2 transition duration-150 ${
            activeTab === 'notes'
              ? 'border-zinc-100 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-350'
          }`}
        >
           caseworker Notes ({(caseFile.notes || []).length})
        </button>
      </div>

      {/* Workspace panel contents */}
      <div className="flex-1 overflow-y-auto p-6 lg:p-8">
        
        {/* Tab 1: Timeline & Logs */}
        {activeTab === 'timeline' && (
          <div className="max-w-3xl space-y-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Order Event Timeline</h3>
            
            {/* Visual Node Tree */}
            <div className="relative pl-6 space-y-6 border-l border-zinc-900">
              {metrics?.canonicalResult ? (
                (metrics.canonicalResult.timeline || []).map((item: any, idx: number) => {
                  const isExecuted = item.eventType === 'ORDER_EXECUTED';
                  const isRequoted = item.eventType === 'DEALER_REQUOTED';
                  const isRejected = item.eventType === 'ORDER_REJECTED' || item.eventType === 'DEALER_REJECTED';
                  
                  // Find corresponding evidence raw log
                  const evidenceItem = metrics.canonicalResult.evidence?.find((e: any) => e.id === item.evidenceId);

                  return (
                    <div key={idx} className="relative group">
                      {/* Visual node status dot */}
                      <div className={`absolute -left-[30px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border bg-zinc-950 ${
                        isExecuted
                          ? 'border-emerald-500 text-emerald-400'
                          : isRejected
                          ? 'border-red-500 text-red-400'
                          : isRequoted
                          ? 'border-amber-500 text-amber-400'
                          : 'border-zinc-800 text-zinc-500'
                      }`}>
                        {isExecuted ? (
                          <CheckCircle className="h-2.5 w-2.5 fill-current" />
                        ) : isRejected ? (
                          <AlertTriangle className="h-2.5 w-2.5 fill-current text-red-400" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(item.timestamp).toISOString()}
                          </span>
                          <span className={`inline-block rounded px-1.5 py-0.2 text-[8px] font-semibold border ${
                            isExecuted
                              ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400'
                              : isRejected
                              ? 'bg-red-950/20 border-red-900/60 text-red-400'
                              : isRequoted
                              ? 'bg-amber-950/20 border-amber-900/60 text-amber-400'
                              : 'bg-zinc-900/40 border-zinc-850 text-zinc-500'
                          }`}>
                            {item.eventType}
                          </span>
                        </div>
                        
                        <div className="pl-0.5">
                          <p className="text-xs text-zinc-200 font-medium">{item.explanation}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5 italic font-mono">{item.technicalDetails}</p>
                          
                          {item.relatedIds && item.relatedIds.length > 0 && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[9px] text-zinc-650 font-semibold uppercase">Related:</span>
                              {item.relatedIds.map((rid: string, i: number) => (
                                <span key={i} className="inline-block bg-zinc-900/60 border border-zinc-850 text-zinc-450 font-mono text-[9px] px-1.5 py-0.1 rounded">
                                  {rid}
                                </span>
                              ))}
                            </div>
                          )}

                          {evidenceItem && (
                            <button
                              onClick={() => setSelectedEvidence({
                                claim: evidenceItem.claim,
                                rawLog: evidenceItem.rawLog,
                                timestamp: evidenceItem.timestamp
                              })}
                              className="mt-2 text-[9px] font-semibold text-zinc-400 hover:text-zinc-200 flex items-center gap-1 border border-zinc-900 bg-zinc-900/20 hover:bg-zinc-900/60 px-2 py-0.5 rounded transition"
                            >
                              <Database className="h-2.5 w-2.5" />
                              View Evidence
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                (caseFile.events || []).map((event, idx) => {
                  const isExecuted = event.eventType === 'DEAL_EXECUTED' || event.eventType === 'ORDER_FILLED';
                  const isRejected = event.eventType === 'ORDER_REJECTED' || event.eventType === 'ORDER_CANCELLED';
                  const isRequoted = event.eventType === 'EXECUTION_RESPONSE' && event.metadata?.requotePrice !== undefined;
 
                   return (
                     <div key={idx} className="relative group">
                       {/* Visual node status dot */}
                       <div className={`absolute -left-[30px] top-0 flex h-4 w-4 items-center justify-center rounded-full border bg-zinc-950 ${
                         isExecuted
                           ? 'border-emerald-500 text-emerald-400'
                           : isRejected
                           ? 'border-red-500 text-red-400'
                           : isRequoted
                           ? 'border-amber-500 text-amber-400'
                           : 'border-zinc-800 text-zinc-500'
                       }`}>
                         {isExecuted ? (
                           <CheckCircle className="h-2.5 w-2.5 fill-current" />
                         ) : isRejected ? (
                           <XCircle className="h-2.5 w-2.5 fill-current" />
                         ) : isRequoted ? (
                           <AlertTriangle className="h-2.5 w-2.5 fill-current" />
                         ) : (
                           <span className="h-1 w-1 rounded-full bg-zinc-500" />
                         )}
                       </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-zinc-500">
                            {new Date(event.timestamp).toISOString()}
                          </span>
                          <span className={`inline-block rounded px-1.5 py-0.2 text-[8px] font-semibold border ${
                            isExecuted
                              ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400'
                              : isRequoted
                              ? 'bg-amber-950/20 border-amber-900/60 text-amber-400'
                              : 'bg-zinc-900/40 border-zinc-850 text-zinc-500'
                          }`}>
                            {event.eventType}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-300 font-medium pl-0.5">{event.rawMessage}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
        {/* Tab 2: Calculated Metrics */}
        {activeTab === 'metrics' && (() => {
          if (!metrics) {
            return (
              <div className="py-8 text-center text-zinc-500 italic text-xs">
                No metrics calculated for this case.
              </div>
            );
          }
           const entryLegs = metrics.entries || (metrics.entry ? [metrics.entry] : (metrics.priceRequested !== undefined ? [metrics] : []));
           const exitLegs = metrics.exits || (metrics.exit ? [metrics.exit] : []);
           const reversalLegs = metrics.reversals || [];
           const entry = entryLegs[0] || null;
           const exit = exitLegs[exitLegs.length - 1] || null;
           const summary = metrics.summary !== undefined ? metrics.summary : {
            netSlippage: {
              slippagePoints: metrics.slippagePoints,
              slippageType: metrics.slippageType
            },
            cumulativeLatency: metrics.totalObservableExecutionTimeMs,
            holdTimeMs: metrics.holdTimeMs
          };

          const renderLegCard = (leg: any, title: string, defaultSide?: string) => {
            const side = leg.action || defaultSide || 'UNKNOWN';
            const precision = leg.digits !== null && leg.digits !== undefined ? leg.digits : 5;
            
            const formatPrice = (val: any) => {
              if (val === null || val === undefined) return 'NOT OBSERVABLE';
              return typeof val === 'number' ? val.toFixed(precision) : val;
            };

            const formatValue = (val: any, suffix = '') => {
              if (val === null || val === undefined) return 'NOT OBSERVABLE';
              return `${val}${suffix}`;
            };

            return (
              <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                  <Clock className="h-4.5 w-4.5 text-zinc-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">{title}</h4>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-zinc-500 block">Side</span>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mt-1 ${
                      side === 'BUY'
                        ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-950/50'
                        : 'bg-red-950/30 text-red-400 border border-red-950/50'
                    }`}>
                      {side}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Volume</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatValue(leg.volume, ' Lot')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Requested Price</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatPrice(leg.priceRequested)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Executed Price</span>
                    <span className="text-zinc-100 font-semibold mt-1 block">
                      {formatPrice(leg.priceExecuted)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Raw Difference</span>
                    <span className={`font-semibold mt-1 block ${
                      leg.priceDelta > 0 ? 'text-amber-400' : leg.priceDelta < 0 ? 'text-emerald-400' : 'text-zinc-500'
                    }`}>
                      {leg.priceDelta !== null && leg.priceDelta !== undefined ? (leg.priceDelta > 0 ? `+${leg.priceDelta.toFixed(precision)}` : leg.priceDelta.toFixed(precision)) : 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Point Size</span>
                    <span className="text-zinc-400 mt-1 block">
                      {leg.pointSize !== null && leg.pointSize !== undefined ? `${leg.pointSize} (${leg.pointSizeSource || 'MT5_SERVER'})` : 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Slippage Points</span>
                    {leg.slippagePoints !== null && leg.slippagePoints !== undefined ? (
                      <span className={`font-bold mt-1 block ${
                        leg.slippageType === 'Adverse' 
                          ? 'text-red-400' 
                          : leg.slippageType === 'Favorable' 
                          ? 'text-emerald-400' 
                          : 'text-zinc-500'
                      }`}>
                        {leg.slippagePoints} points
                      </span>
                    ) : (
                      <span className="text-red-450/80 mt-1 block italic text-[10px]">NOT OBSERVABLE</span>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Classification</span>
                    <span className={`font-semibold mt-1 block ${
                      leg.slippageType === 'Adverse' 
                        ? 'text-red-400' 
                        : leg.slippageType === 'Favorable' 
                        ? 'text-emerald-400' 
                        : 'text-zinc-500'
                    }`}>
                      {leg.slippageType || 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Total Observable Execution Time</span>
                    <span className="text-zinc-100 font-semibold mt-1 block">
                      {formatValue(leg.totalObservableExecutionTimeMs, ' ms')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Routing Delay</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatValue(leg.routingDelayMs, ' ms')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Execution Request Delay</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatValue(leg.executionRequestDelayMs, ' ms')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Execution Processing</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatValue(leg.executionProcessingMs, ' ms')}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Dealer/Bridge Response Time</span>
                    <span className="text-zinc-300 font-semibold mt-1 block">
                      {formatValue(leg.dealerBridgeResponseTimeMs, ' ms')}
                    </span>
                  </div>

                  {leg.pendingWaitingTimeMs !== null && leg.pendingWaitingTimeMs !== undefined && (
                    <div>
                      <span className="text-[10px] text-zinc-500 block">Pending Waiting Time</span>
                      <span className="text-zinc-300 font-semibold mt-1 block">
                        {leg.pendingWaitingTimeMs} ms
                      </span>
                    </div>
                  )}

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Position ID</span>
                    <span className="text-zinc-400 font-semibold mt-1 block">
                      {leg.positionId || 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Order ID</span>
                    <span className="text-zinc-400 font-semibold mt-1 block">
                      {leg.orderId || 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Deal ID</span>
                    <span className="text-zinc-450 font-semibold mt-1 block">
                      {leg.dealId || 'NOT OBSERVABLE'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-zinc-500 block">Request ID</span>
                    <span className="text-zinc-450 font-semibold mt-1 block">
                      {leg.requestId || 'NOT OBSERVABLE'}
                    </span>
                  </div>
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Calculated Trade Metrics</h3>
                <p className="text-xs text-zinc-500 mt-1">Calculated programmatically from raw server timeline logs.</p>
              </div>

              {/* Dynamic Execution Legs */}
              <div className="grid gap-6 md:grid-cols-2">
                {entryLegs.map((leg: any, idx: number) => 
                  renderLegCard(leg, `Entry Leg #${idx + 1} (${leg.symbol || 'N/A'})`, 'BUY')
                )}
                {exitLegs.map((leg: any, idx: number) => 
                  renderLegCard(leg, `Exit Leg #${idx + 1} (${leg.symbol || 'N/A'})`, 'SELL')
                )}
                {reversalLegs.map((leg: any, idx: number) => 
                  renderLegCard(leg, `Reversal Leg #${idx + 1} (${leg.symbol || 'N/A'})`, 'BUY')
                )}
              </div>

              {exitLegs.length === 0 && (
                <div className="py-8 text-center text-zinc-500 italic text-xs rounded-xl border border-zinc-900 bg-zinc-900/10 p-6">
                  No exit execution data parsed (active open position or flat import history).
                </div>
              )}

              {entryLegs[0]?.rejection?.isRejected ? (
                <div className="rounded-xl border border-red-950 bg-red-950/10 p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-red-950 pb-3">
                    <AlertTriangle className="h-4.5 w-4.5 text-red-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-400">Trade Request Rejected</h4>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-3 text-xs font-mono">
                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Rejection Reason</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block">
                        {entryLegs[0].rejection.reason}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        Raw log: "{entryLegs[0].rejection.rawReason || 'NOT OBSERVABLE'}"
                      </span>
                    </div>

                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Rejected By</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block">
                        {entryLegs[0].rejection.rejectedBy}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        System component or Desk
                      </span>
                    </div>

                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Failed Stage</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block font-semibold text-red-400">
                        {entryLegs[0].rejection.failedStage}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        Last successful: {entryLegs[0].rejection.lastSuccessfulStage}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 bg-red-950/5 p-4 rounded-lg border border-red-950/30">
                    <p className="font-semibold text-red-300">Failure Explanation:</p>
                    <p className="mt-1 leading-relaxed">
                      The client request successfully completed the <strong>{entryLegs[0].rejection.lastSuccessfulStage}</strong> stage, but failed at <strong>{entryLegs[0].rejection.failedStage}</strong> after being rejected by <strong>{entryLegs[0].rejection.rejectedBy}</strong>. Deal execution did not occur, and no market position was created.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                    <Activity className="h-4.5 w-4.5 text-zinc-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Overall Trade Summary</h4>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-3">
                    <div className="bg-zinc-950/20 border border-zinc-900/50 rounded-lg p-4">
                      <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Net Round-Trip Slippage</span>
                      <span className={`text-xl font-bold mt-1 block font-mono ${
                        summary.netSlippage?.slippageType === 'Adverse' 
                          ? 'text-red-400' 
                          : summary.netSlippage?.slippageType === 'Favorable' 
                          ? 'text-emerald-400' 
                          : 'text-zinc-400'
                      }`}>
                        {summary.netSlippage?.slippagePoints !== null && summary.netSlippage?.slippagePoints !== undefined
                          ? `${summary.netSlippage.slippagePoints} points ${summary.netSlippage.slippageType}`
                          : 'NOT OBSERVABLE'}
                      </span>
                      <div className="text-[9px] text-zinc-500 space-y-0.5 mt-2 pt-2 border-t border-zinc-900/50 font-mono">
                        <div>Entry: {entryLegs[0]?.slippagePoints !== null && entryLegs[0]?.slippagePoints !== undefined ? `${entryLegs[0].slippagePoints} points ${entryLegs[0].slippageType}` : 'NOT OBSERVABLE'}</div>
                        {exitLegs[0] && (
                          <>
                            <div>Exit: {exitLegs[0].slippagePoints !== null && exitLegs[0].slippagePoints !== undefined ? `${exitLegs[0].slippagePoints} points ${exitLegs[0].slippageType}` : 'NOT OBSERVABLE'}</div>
                            <div className="text-amber-400/80 font-medium">Brokeree Applied: {exitLegs[0].slippagePoints !== null && exitLegs[0].slippagePoints !== undefined ? `${exitLegs[0].slippagePoints} points Adverse` : 'NOT OBSERVABLE'}</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-950/20 border border-zinc-900/50 rounded-lg p-4">
                      <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Cumulative Execution Time</span>
                      <span className="text-xl font-bold text-zinc-100 mt-1 block font-mono">
                        {summary.cumulativeLatency !== undefined && summary.cumulativeLatency !== null 
                          ? `${summary.cumulativeLatency.toFixed(0)} ms` 
                          : 'NOT OBSERVABLE'}
                      </span>
                      <div className="text-[9px] text-zinc-500 space-y-0.5 mt-2 pt-2 border-t border-zinc-900/50 font-mono">
                        <div>Entry Time: {entryLegs[0]?.totalObservableExecutionTimeMs !== null && entryLegs[0]?.totalObservableExecutionTimeMs !== undefined ? `${entryLegs[0].totalObservableExecutionTimeMs.toFixed(0)} ms` : 'NOT OBSERVABLE'}</div>
                        {exitLegs[0] && (
                          <div>Exit Time: {exitLegs[0].totalObservableExecutionTimeMs !== null && exitLegs[0].totalObservableExecutionTimeMs !== undefined ? `${exitLegs[0].totalObservableExecutionTimeMs.toFixed(0)} ms` : 'NOT OBSERVABLE'}</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-950/20 border border-zinc-900/50 rounded-lg p-4">
                      <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Trade & Execution Details</span>
                      <div className="text-[10px] text-zinc-300 space-y-1.5 mt-2 font-mono">
                        <div>Hold Time: <span className="font-semibold text-zinc-100">{(() => {
                          const ms = summary.holdTimeMs;
                          if (ms === null || ms === undefined) return 'NOT OBSERVABLE';
                          if (ms < 1000) return `${ms} ms`;
                          const totalSec = Math.round(ms / 1000);
                          if (totalSec < 60) return `${(ms / 1000).toFixed(1)}s`;
                          const minutes = Math.floor(totalSec / 60);
                          const seconds = totalSec % 60;
                          if (minutes < 60) {
                            return `${minutes}m ${seconds}s`;
                          }
                          const hours = Math.floor(minutes / 60);
                          const remainingMinutes = minutes % 60;
                          return `${hours}h ${remainingMinutes}m ${seconds}s`;
                        })()}</span></div>
                        <div>Reason: <span className="font-semibold text-zinc-100">{entryLegs[0]?.executionReason || 'NOT OBSERVABLE'}</span></div>
                        <div>Type: <span className="font-semibold text-zinc-100">{entryLegs[0]?.orderType || 'NOT OBSERVABLE'}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Quality & Integrity Summary */}
              <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                  <Activity className="h-4.5 w-4.5 text-zinc-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Data Quality & Integrity Summary</h4>
                </div>
                <div className="grid gap-4 sm:grid-cols-3 text-xs font-mono">
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Correlation</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      metrics.correlationQuality === 'KNOWN' || (!metrics.correlationQuality) ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {metrics.correlationQuality || (entryLegs[0]?.correlationMethod === 'PROXIMITY_FALLBACK' ? 'AMBIGUOUS' : 'KNOWN')}
                    </span>
                  </div>
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Timing</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      (metrics.timingQuality || 'KNOWN') === 'KNOWN' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {metrics.timingQuality || 'KNOWN'}
                    </span>
                  </div>
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Execution</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      (metrics.executionQuality || 'KNOWN') === 'KNOWN' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {metrics.executionQuality || 'KNOWN'}
                    </span>
                  </div>
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Timezone</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      (metrics.timezoneQuality || 'KNOWN') === 'KNOWN' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {metrics.timezoneQuality || 'KNOWN'}
                    </span>
                  </div>
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Position Lifecycle</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      exitLegs.length > 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {entryLegs[0]?.rejection?.isRejected ? 'NOT_OBSERVABLE' : (exitLegs.length > 0 ? 'COMPLETE' : 'INCOMPLETE')}
                    </span>
                  </div>
                  <div className="bg-zinc-950/25 border border-zinc-900/50 rounded-lg p-3">
                    <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Financial Data</span>
                    <span className={`text-xs font-bold mt-1 block ${
                      exitLegs.length > 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {entryLegs[0]?.rejection?.isRejected ? 'NOT_OBSERVABLE' : (exitLegs.length > 0 ? 'COMPLETE' : 'INCOMPLETE')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quality Summary banner */}
              {entry.rejection?.isRejected ? (
                <div className="rounded-xl border border-red-950 bg-red-950/10 text-red-400 p-5 flex items-start gap-4 max-w-2xl">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="text-xs font-bold uppercase tracking-wider font-semibold">Audit Alert: Order Rejected</h5>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                      The compliance audit has flagged this order as rejected due to "{entry.rejection.reason}". Dynamic log checks confirmed that no execution deal was performed, leaving the position uncreated.
                    </p>
                  </div>
                </div>
              ) : (
                <div className={`rounded-xl border p-5 flex items-start gap-4 max-w-2xl ${
                  entry.isNormal && (!exit || exit.isNormal)
                    ? 'border-emerald-950 bg-emerald-950/10 text-emerald-400' 
                    : 'border-amber-950 bg-amber-950/10 text-amber-400'
                }`}>
                  {entry.isNormal && (!exit || exit.isNormal) ? (
                    <>
                      <CheckCircle className="h-5 w-5 shrink-0 mt-0.5 text-emerald-500" />
                      <div className="text-xs">
                        <h5 className="font-semibold mb-0.5">Execution parameters normal</h5>
                        <p className="text-emerald-500/80 leading-relaxed">
                          All transaction legs met standard broker speed thresholds (under 300ms) with minimal price slippage and zero requotes.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
                      <div className="text-xs">
                        <h5 className="font-semibold mb-0.5">Execution parameters exceeded normal thresholds</h5>
                        <p className="text-amber-500/80 leading-relaxed">
                          Adverse slippage, latencies, or dealer requote events occurred on one or more transaction legs. Check timelines above.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Tab 3: AI Analysis & Chat */}
        {activeTab === 'ai' && (
          <div className="grid gap-8 lg:grid-cols-12 h-full items-start max-w-6xl">
            {/* AI Report Card */}
            <div className="lg:col-span-7 rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4.5 w-4.5 text-zinc-400" />
                  <h3 className="text-sm font-semibold tracking-tight text-zinc-200">AI Incident Investigation Report</h3>
                </div>
                {latestAiReport && (
                  <button
                    onClick={() => analyzeMutation.mutate()}
                    disabled={analyzeMutation.isPending}
                    className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-[10px] font-semibold text-zinc-300 hover:text-zinc-150 hover:bg-zinc-850 active:bg-zinc-900 transition animate-fade-in"
                  >
                    {analyzeMutation.isPending ? 'Generating Investigation...' : 'Regenerate AI Audit Report'}
                  </button>
                )}
              </div>
 
              {latestAiReport ? (() => {
                let parsed: any = null;
                try {
                  parsed = JSON.parse(latestAiReport.response);
                } catch (e) {
                  // Legacy/markdown fallback
                }

                if (!parsed) {
                  return (
                    <div className="text-xs text-zinc-300 leading-relaxed font-sans space-y-4 whitespace-pre-wrap text-left">
                      {latestAiReport.response}
                    </div>
                  );
                }

                const status = parsed.outcome?.status || parsed.outcome || 'UNKNOWN';
                const confidence = parsed.outcome?.confidence || 'UNKNOWN';
                const executiveSummary = parsed.executiveSummary || parsed.summary || '';
                const whatHappened = parsed.whatHappened || [];
                const executionAnalysis = parsed.executionAnalysis || {};
                const slippageAnalysis = parsed.slippageAnalysis || {};
                const timingAnalysis = parsed.timingAnalysis || {};
                const positionLifecycle = parsed.positionLifecycle || parsed.lifecycleAnalysis || [];
                const rejectionAnalysis = parsed.rejectionAnalysis || null;
                const anomalies = parsed.anomalies || [];
                const evidence = parsed.evidence || [];
                const limitations = parsed.limitations || [];

                const getOutcomeBadgeClass = (s: string) => {
                  switch (s) {
                    case 'SUCCESSFUL':
                    case 'CLOSED':
                      return 'bg-emerald-950/30 text-emerald-400 border-emerald-950/60';
                    case 'REJECTED':
                      return 'bg-red-950/30 text-red-400 border-red-950/60';
                    case 'REQUOTED_THEN_EXECUTED':
                    case 'PARTIALLY_EXECUTED':
                    case 'REVERSED':
                    case 'OPEN':
                      return 'bg-amber-950/30 text-amber-400 border-amber-950/60';
                    default:
                      return 'bg-zinc-900/40 border-zinc-850 text-zinc-400';
                  }
                };

                const renderWhatHappened = () => {
                  if (Array.isArray(whatHappened)) {
                    return (
                      <ul className="list-disc list-inside space-y-1.5 pl-1.5 text-zinc-300">
                        {whatHappened.map((step: string, idx: number) => (
                          <li key={idx} className="leading-relaxed text-[11px]">{step}</li>
                        ))}
                      </ul>
                    );
                  }
                  return <p className="leading-relaxed whitespace-pre-line text-[11px]">{whatHappened}</p>;
                };

                const renderExecutionAnalysis = () => {
                  if (typeof executionAnalysis === 'string') {
                    return <p className="leading-relaxed whitespace-pre-line text-[11px]">{executionAnalysis}</p>;
                  }
                  return (
                    <div className="space-y-3 font-mono text-[10px]">
                      {executionAnalysis.entry && (
                        <div>
                          <span className="font-semibold text-zinc-500 uppercase text-[9px] block mb-0.5">Entry Execution</span>
                          <p className="text-zinc-300 bg-zinc-950/40 border border-zinc-900 rounded px-2.5 py-1.5 leading-relaxed">{executionAnalysis.entry}</p>
                        </div>
                      )}
                      {executionAnalysis.exit && executionAnalysis.exit !== 'NOT_OBSERVABLE' && (
                        <div>
                          <span className="font-semibold text-zinc-500 uppercase text-[9px] block mb-0.5">Exit Execution</span>
                          <p className="text-zinc-300 bg-zinc-950/40 border border-zinc-900 rounded px-2.5 py-1.5 leading-relaxed">{executionAnalysis.exit}</p>
                        </div>
                      )}
                      {executionAnalysis.reversal && executionAnalysis.reversal !== 'NOT_OBSERVABLE' && (
                        <div>
                          <span className="font-semibold text-zinc-500 uppercase text-[9px] block mb-0.5">Reversal / Other Leg</span>
                          <p className="text-zinc-300 bg-zinc-950/40 border border-zinc-900 rounded px-2.5 py-1.5 leading-relaxed">{executionAnalysis.reversal}</p>
                        </div>
                      )}
                    </div>
                  );
                };

                const renderSlippageAnalysis = () => {
                  if (typeof slippageAnalysis === 'string') {
                    return <p className="leading-relaxed whitespace-pre-line text-[11px]">{slippageAnalysis}</p>;
                  }
                  return (
                    <div className="space-y-4 text-[11px]">
                      <p className="leading-relaxed">{slippageAnalysis.summary}</p>
                      {slippageAnalysis.legs && slippageAnalysis.legs.length > 0 && (
                        <div className="overflow-x-auto border border-zinc-900 rounded-lg">
                          <table className="w-full text-left text-[10px] font-mono border-collapse divide-y divide-zinc-900">
                            <thead>
                              <tr className="bg-zinc-950/40 text-zinc-500 font-semibold">
                                <th className="p-2">Leg</th>
                                <th className="p-2 text-right">Requested</th>
                                <th className="p-2 text-right">Executed</th>
                                <th className="p-2 text-right">Slippage</th>
                                <th className="p-2">Type</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-900/50">
                              {slippageAnalysis.legs.map((leg: any, idx: number) => (
                                <tr key={idx} className="hover:bg-zinc-900/20 transition">
                                  <td className="p-2 font-bold text-zinc-400">{leg.leg}</td>
                                  <td className="p-2 text-right text-zinc-300">{leg.requestedPrice}</td>
                                  <td className="p-2 text-right text-zinc-300">{leg.executedPrice}</td>
                                  <td className="p-2 text-right text-zinc-300">{leg.slippagePoints} pts</td>
                                  <td className={`p-2 font-bold ${
                                    leg.classification === 'ADVERSE' ? 'text-red-400' : leg.classification === 'FAVORABLE' ? 'text-emerald-400' : 'text-zinc-500'
                                  }`}>{leg.classification}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {slippageAnalysis.tradeLevelConclusion && slippageAnalysis.tradeLevelConclusion !== 'NOT_OBSERVABLE' && (
                        <p className="border-t border-zinc-900 pt-2 font-semibold text-zinc-200">{slippageAnalysis.tradeLevelConclusion}</p>
                      )}
                    </div>
                  );
                };

                const renderTimingAnalysis = () => {
                  if (typeof timingAnalysis === 'string') {
                    return <p className="leading-relaxed whitespace-pre-line text-[11px]">{timingAnalysis}</p>;
                  }
                  return (
                    <div className="space-y-4 text-[11px]">
                      <p className="leading-relaxed">{timingAnalysis.summary}</p>
                      <div className="grid gap-3 sm:grid-cols-2 text-[10px] font-mono">
                        <div className="bg-zinc-950/30 border border-zinc-900 rounded p-2.5">
                          <span className="text-zinc-500 block mb-0.5 uppercase text-[9px] font-semibold">Routing Delay</span>
                          <span className="text-zinc-300 font-semibold">{timingAnalysis.routingDelay}</span>
                        </div>
                        <div className="bg-zinc-950/30 border border-zinc-900 rounded p-2.5">
                          <span className="text-zinc-500 block mb-0.5 uppercase text-[9px] font-semibold">Execution Delay</span>
                          <span className="text-zinc-300 font-semibold">{timingAnalysis.executionDelay}</span>
                        </div>
                        <div className="bg-zinc-950/30 border border-zinc-900 rounded p-2.5">
                          <span className="text-zinc-500 block mb-0.5 uppercase text-[9px] font-semibold">Dealer Response</span>
                          <span className="text-zinc-300 font-semibold">{timingAnalysis.dealerResponseTime}</span>
                        </div>
                        <div className="bg-zinc-950/30 border border-zinc-900 rounded p-2.5">
                          <span className="text-zinc-500 block mb-0.5 uppercase text-[9px] font-semibold">Quality Tier</span>
                          <span className="text-zinc-300 font-semibold">{timingAnalysis.quality}</span>
                        </div>
                      </div>
                    </div>
                  );
                };

                const renderPositionLifecycle = () => {
                  if (Array.isArray(positionLifecycle)) {
                    return (
                      <ul className="list-disc list-inside space-y-1.5 pl-1.5 text-zinc-300">
                        {positionLifecycle.map((step: string, idx: number) => (
                          <li key={idx} className="leading-relaxed text-[11px]">{step}</li>
                        ))}
                      </ul>
                    );
                  }
                  return <p className="leading-relaxed whitespace-pre-line text-[11px]">{positionLifecycle}</p>;
                };

                const renderRejectionAnalysis = () => {
                  if (!rejectionAnalysis || !rejectionAnalysis.isRejected) return null;
                  return (
                    <div className="bg-red-950/5 border border-red-950 rounded-xl p-5 space-y-3 text-left">
                      <h4 className="text-[10px] uppercase font-bold text-red-400 border-b border-red-950/30 pb-1.5 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Rejection Analysis</h4>
                      <div className="grid gap-4 sm:grid-cols-4 font-mono text-[10px]">
                        <div>
                          <span className="text-zinc-500 block uppercase text-[9px] mb-0.5">Stage</span>
                          <span className="text-zinc-300 font-semibold">{rejectionAnalysis.stage || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-550 block uppercase text-[9px] mb-0.5">Reason Code</span>
                          <span className="text-zinc-350 font-semibold">{rejectionAnalysis.reason || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block uppercase text-[9px] mb-0.5">Retcode</span>
                          <span className="text-zinc-300 font-semibold">{rejectionAnalysis.retcode ? `#${rejectionAnalysis.retcode}` : 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500 block uppercase text-[9px] mb-0.5">Source Component</span>
                          <span className="text-zinc-300 font-semibold">{rejectionAnalysis.source || 'N/A'}</span>
                        </div>
                      </div>
                      {rejectionAnalysis.explanation && (
                        <p className="text-zinc-400 mt-2 leading-relaxed italic border-t border-zinc-900/50 pt-2 text-[11px]">{rejectionAnalysis.explanation}</p>
                      )}
                    </div>
                  );
                };

                const renderEvidence = () => {
                  if (!evidence || evidence.length === 0) return null;
                  return (
                    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3 text-left">
                      <h4 className="text-[10px] uppercase font-bold text-zinc-500 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Evidence References</h4>
                      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 font-mono">
                        {evidence.map((ev: any, idx: number) => (
                          <div key={idx} className="bg-zinc-950/20 border border-zinc-900/50 rounded p-2.5 flex items-start justify-between gap-4 hover:border-zinc-800 transition">
                            <div className="space-y-1">
                              <p className="text-[11px] text-zinc-300 font-medium font-sans">{ev.explanation || ev.claim}</p>
                              <div className="flex items-center gap-3 text-[9px] text-zinc-500 font-mono">
                                <span>Event: {ev.event || ev.eventType}</span>
                                {ev.timestamp && <span>Time: {ev.timestamp}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                };

                return (
                  <div className="space-y-6 text-xs text-zinc-300 font-sans max-w-3xl text-left animate-fade-in">
                    {/* Outcome & Summary Section */}
                    <div className="flex flex-col gap-4 bg-zinc-900/10 border border-zinc-900 rounded-xl p-5">
                      <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                        <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Compliance Trade Outcome</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-zinc-500">Confidence: {confidence}</span>
                          <span className={`inline-block border px-2.5 py-0.5 rounded text-[10px] font-bold ${getOutcomeBadgeClass(status)}`}>
                            {status}
                          </span>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-1">Executive Summary</h4>
                        <p className="text-zinc-100 font-medium leading-relaxed font-mono">{executiveSummary}</p>
                      </div>
                    </div>

                    {/* Operational Details Sections */}
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> What Happened</h4>
                        {renderWhatHappened()}
                      </div>

                      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5" /> Slippage Analysis</h4>
                        {renderSlippageAnalysis()}
                      </div>

                      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Timing & Latency Analysis</h4>
                        {renderTimingAnalysis()}
                      </div>

                      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Position Lifecycle Analysis</h4>
                        {renderPositionLifecycle()}
                      </div>
                    </div>

                    {/* Execution Details */}
                    {parsed.executionAnalysis && (
                      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-3">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550 border-b border-zinc-900 pb-1.5 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Leg Execution Details</h4>
                        {renderExecutionAnalysis()}
                      </div>
                    )}

                    {/* Rejection Analysis Block */}
                    {renderRejectionAnalysis()}

                    {/* Warnings & Anomalies Block */}
                    {anomalies && anomalies.length > 0 && (
                      <div className="bg-amber-950/5 border border-amber-950/65 rounded-xl p-5 space-y-2 text-left">
                        <h4 className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Flagged Investigations & Observations</h4>
                        <ul className="list-disc list-inside space-y-1 text-zinc-400 pl-1.5">
                          {anomalies.map((anom: string, idx: number) => (
                            <li key={idx} className="leading-relaxed text-[11px]">{anom}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Evidence Logs Tracing Reference Block */}
                    {renderEvidence()}

                    {/* Limitations Section */}
                    {limitations && limitations.length > 0 && (
                      <div className="bg-zinc-900/5 border border-zinc-900/40 rounded-xl p-5 space-y-2 text-left">
                        <h4 className="text-[10px] uppercase font-bold text-zinc-550">Logs Integrity & Limitations</h4>
                        <ul className="list-disc list-inside space-y-1 text-zinc-500 pl-1">
                          {limitations.map((limit: string, idx: number) => (
                            <li key={idx} className="leading-relaxed text-[11px]">{limit}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })() : (
                <div className="py-16 text-center space-y-5 animate-fade-in">
                  <FileText className="mx-auto h-8 w-8 text-zinc-700 animate-pulse" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-zinc-200">AI Audit Report</h4>
                    <p className="text-xs text-zinc-400 font-medium">
                      No AI investigation has been generated for this trade yet.
                    </p>
                    <p className="text-[11px] text-zinc-500 max-w-sm mx-auto">
                      Generate an AI Audit Report to analyze the MT5 logs and explain what happened.
                    </p>
                  </div>
                  <button
                    onClick={() => analyzeMutation.mutate()}
                    disabled={analyzeMutation.isPending}
                    className="rounded-lg bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition shadow"
                  >
                    {analyzeMutation.isPending ? 'Generating Investigation...' : 'Generate AI Audit Report'}
                  </button>
                </div>
              )}
            </div>

            {/* AI Chat Feed */}
            <div className="lg:col-span-5 flex flex-col h-[500px] rounded-xl border border-indigo-900/40 bg-indigo-950/10 shadow-[0_0_30px_rgba(99,102,241,0.03)] overflow-hidden">
              <div className="border-b border-indigo-900/30 bg-indigo-950/30 px-4 py-3 flex items-center gap-2 shrink-0">
                <MessageSquare className="h-4 w-4 text-indigo-400" />
                <span className="text-xs font-semibold tracking-tight text-zinc-200">Operations Assistant Chat</span>
              </div>

              {/* Message History Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-sans">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col justify-center items-center text-zinc-500 p-6 space-y-4">
                    <p className="text-center italic">
                      Ask a question about this trade...
                    </p>
                    <div className="w-full max-w-sm grid gap-2">
                      {getSuggestedQuestions().map((q, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setChatMessages((prev) => [...prev, { role: 'user', content: q }]);
                            chatMutation.mutate(q);
                          }}
                          className="text-left w-full rounded-lg border border-indigo-900/30 bg-indigo-950/20 px-3 py-2 text-[10px] text-zinc-300 hover:bg-indigo-950/40 hover:text-zinc-150 transition"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col max-w-[85%] rounded-lg p-3 shadow-md ${
                        msg.role === 'user'
                          ? 'bg-zinc-900 border border-zinc-800 text-zinc-100 ml-auto'
                          : 'bg-indigo-950/40 border border-indigo-900/40 text-zinc-100 mr-auto'
                      }`}
                    >
                      <span className="text-[9px] font-semibold font-mono text-zinc-500 uppercase mb-1">
                        {msg.role === 'user' ? 'Caseworker' : 'AI Investigator'}
                      </span>
                      <p className="leading-relaxed">{msg.content}</p>
                    </div>
                  ))
                )}
                {chatMutation.isPending && (
                  <div className="bg-zinc-950 border border-zinc-900 text-zinc-300 mr-auto max-w-[85%] rounded-lg p-3 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0.4s]" />
                  </div>
                )}
              </div>

              {/* Chat Input form */}
              <form onSubmit={handleChatSubmit} className="border-t border-zinc-900 p-3 bg-zinc-950/40 shrink-0 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question about this trade..."
                  disabled={chatMutation.isPending}
                  className="flex-1 rounded-lg border border-zinc-900 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-800 transition disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || chatMutation.isPending}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition disabled:opacity-50 shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 4: notes */}
        {activeTab === 'notes' && (
          <div className="max-w-2xl space-y-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Casework Notes & Logs</h3>

            <form onSubmit={handleNoteSubmit} className="space-y-3">
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Type note details about this trade dispute..."
                rows={3}
                className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-3 text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
              />
              <button
                type="submit"
                disabled={!noteContent.trim() || noteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 transition disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Note</span>
              </button>
            </form>

            <div className="space-y-4 pt-4 border-t border-zinc-900/60">
              {caseFile.notes && caseFile.notes.length > 0 ? (
                (caseFile.notes || []).map((note) => (
                  <div key={note.id} className="rounded-lg border border-zinc-900/60 bg-zinc-900/5 p-4 space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-300">{note.user?.name}</span>
                        <span className="rounded bg-zinc-900 border border-zinc-850 px-1.5 py-0.2 font-mono text-[8px]">
                          {note.user?.role}
                        </span>
                      </div>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed font-sans">{note.content}</p>
                  </div>
                ))
              ) : (
                <div className="text-zinc-600 text-xs italic py-4">
                  No casework logs recorded for this file yet.
                </div>
              )}
            </div>
          </div>
        )}

      </div>
      {/* Evidence Viewer Overlay Dialog */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4.5 w-4.5 text-zinc-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Raw Log Evidence</h3>
              </div>
              <button
                onClick={() => setSelectedEvidence(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 font-medium transition"
              >
                Close
              </button>
            </div>
            
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] text-zinc-500 block uppercase font-mono tracking-wider">Timestamp</span>
                <span className="text-zinc-350 font-mono mt-0.5 block">{selectedEvidence.timestamp}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 block uppercase font-mono tracking-wider">Claim</span>
                <span className="text-zinc-200 font-semibold mt-0.5 block">{selectedEvidence.claim}</span>
              </div>
              <div>
                <span className="text-[10px] text-zinc-500 block uppercase font-mono tracking-wider">Raw MT5 Log Output</span>
                <pre className="mt-1.5 p-3 rounded-lg border border-zinc-900 bg-zinc-900/40 text-zinc-350 font-mono text-[10px] overflow-x-auto whitespace-pre-wrap break-all select-all leading-normal">
                  {selectedEvidence.rawLog}
                </pre>
              </div>
            </div>
            
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedEvidence(null)}
                className="rounded-lg bg-zinc-800 border border-zinc-700/60 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-750 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
