import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Database, User, Calendar, Activity, 
  Clock, AlertTriangle, MessageSquare, 
  Send, Plus, FileText, CheckCircle, HelpCircle
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
      <header className="border-b border-zinc-900 bg-zinc-950/40 px-6 py-4 flex items-center justify-between shrink-0">
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
                  The trade request for <strong>{metrics.canonicalResult.trade.volume} Lot {metrics.canonicalResult.trade.symbol}</strong> was successfully executed at price <strong>{metrics.canonicalResult.execution.executionPrice}</strong>. Execution latency was <strong>{metrics.canonicalResult.execution.executionLatencyMs} ms</strong> with <strong>{metrics.canonicalResult.execution.slippagePips !== null ? `${metrics.canonicalResult.execution.slippagePips} pips` : 'no'}</strong> slippage.
                </>
              )}
              {metrics.canonicalResult.status === 'REJECTED' && (
                <>
                  The trade request was explicitly rejected during the <strong>{metrics.canonicalResult.rejection.failedStage}</strong> stage by <strong>{metrics.canonicalResult.rejection.rejectedBy}</strong> due to: <strong>"{metrics.canonicalResult.rejection.reason}"</strong>. Rejection latency was <strong>{metrics.canonicalResult.rejection.rejectionLatencyMs} ms</strong>.
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
      <div className="border-b border-zinc-900 bg-zinc-950/20 px-6 shrink-0 flex">
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
                  const isExecuted = event.eventType === 'ORDER_EXECUTED';
                  const isRequoted = event.eventType === 'DEALER_REQUOTED';

                  return (
                    <div key={idx} className="relative group">
                      {/* Visual node status dot */}
                      <div className={`absolute -left-[30px] top-0 flex h-4 w-4 items-center justify-center rounded-full border bg-zinc-950 ${
                        isExecuted
                          ? 'border-emerald-500 text-emerald-400'
                          : isRequoted
                          ? 'border-amber-500 text-amber-400'
                          : 'border-zinc-800 text-zinc-500'
                      }`}>
                        {isExecuted ? (
                          <CheckCircle className="h-2.5 w-2.5 fill-current" />
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
          const entry = metrics.entry !== undefined ? metrics.entry : metrics;
          const exit = metrics.exit !== undefined ? metrics.exit : null;
          const summary = metrics.summary !== undefined ? metrics.summary : {
            netAdversePriceImpact: metrics.slippagePips > 0 ? metrics.slippagePips : 0,
            cumulativeLatencyMs: metrics.executionLatencyMs
          };

          return (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Calculated Trade Metrics</h3>
                <p className="text-xs text-zinc-500 mt-1">Calculated programmatically from raw server timeline logs.</p>
              </div>

              {/* Side-by-Side Execution Breakdown */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Opening / Entry Card */}
                <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                    <Clock className="h-4.5 w-4.5 text-zinc-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Opening (Entry) Execution</h4>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-zinc-500 block">Side</span>
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mt-1 ${
                        caseFile.title.includes('BUY')
                          ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-950/50'
                          : 'bg-red-950/30 text-red-400 border border-red-950/50'
                      }`}>
                        {caseFile.title.includes('BUY') ? 'BUY' : 'SELL'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Requested Price</span>
                      <span className="text-zinc-300 font-semibold mt-1 block">
                        {entry.priceRequested !== undefined && entry.priceRequested !== null ? entry.priceRequested.toFixed(5) : 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Executed Price</span>
                      <span className="text-zinc-100 font-semibold mt-1 block">
                        {entry.priceExecuted !== undefined && entry.priceExecuted !== null ? entry.priceExecuted.toFixed(5) : 'N/A (Rejected)'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Raw Difference</span>
                      <span className={`font-semibold mt-1 block ${
                        entry.priceDelta > 0 ? 'text-amber-400' : entry.priceDelta < 0 ? 'text-emerald-400' : 'text-zinc-500'
                      }`}>
                        {entry.priceExecuted !== null ? (entry.priceDelta > 0 ? `+${entry.priceDelta.toFixed(5)}` : entry.priceDelta?.toFixed(5)) : 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Point Size</span>
                      <span className="text-zinc-400 mt-1 block">
                        {entry.pointSize !== null && entry.pointSize !== undefined ? entry.pointSize : 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Slippage Points</span>
                      {entry.slippagePoints !== null && entry.slippagePoints !== undefined ? (
                        <span className={`font-bold mt-1 block ${
                          entry.slippageType === 'Adverse' 
                            ? 'text-red-400' 
                            : entry.slippageType === 'Favorable' 
                            ? 'text-emerald-400' 
                            : 'text-zinc-500'
                        }`}>
                          {entry.slippagePoints} points
                        </span>
                      ) : (
                        <span className="text-zinc-500 mt-1 block italic text-[10px]">N/A</span>
                      )}
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Classification</span>
                      <span className={`font-semibold mt-1 block ${
                        entry.slippageType === 'Adverse' 
                          ? 'text-red-400' 
                          : entry.slippageType === 'Favorable' 
                          ? 'text-emerald-400' 
                          : 'text-zinc-500'
                      }`}>
                        {entry.slippageType || 'N/A'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-zinc-500 block">Execution Latency</span>
                      <span className="text-zinc-300 font-semibold mt-1 block">
                        {entry.executionLatencyMs !== null && entry.executionLatencyMs !== undefined ? `${entry.executionLatencyMs} ms` : 'N/A'}
                      </span>
                    </div>

                    {entry.rejectionLatencyMs !== null && entry.rejectionLatencyMs !== undefined && (
                      <div>
                        <span className="text-[10px] text-red-400 block font-semibold">Rejection Latency</span>
                        <span className="text-red-400 font-bold mt-1 block">
                          {entry.rejectionLatencyMs} ms
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Closing / Exit Card */}
                <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                    <Clock className="h-4.5 w-4.5 text-zinc-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Closing (Exit) Execution</h4>
                  </div>

                  {exit ? (
                    <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-zinc-500 block">Side</span>
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mt-1 ${
                          caseFile.title.includes('BUY')
                            ? 'bg-red-950/30 text-red-400 border border-red-950/50'
                            : 'bg-emerald-950/30 text-emerald-400 border border-emerald-950/50'
                        }`}>
                          {caseFile.title.includes('BUY') ? 'SELL' : 'BUY'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Requested Price</span>
                        <span className="text-zinc-300 font-semibold mt-1 block">
                          {exit.priceRequested !== undefined && exit.priceRequested !== null ? exit.priceRequested.toFixed(5) : 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Executed Price</span>
                        <span className="text-zinc-100 font-semibold mt-1 block">
                          {exit.priceExecuted !== undefined && exit.priceExecuted !== null ? exit.priceExecuted.toFixed(5) : 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Raw Difference</span>
                        <span className={`font-semibold mt-1 block ${
                          exit.priceDelta > 0 ? 'text-amber-400' : exit.priceDelta < 0 ? 'text-emerald-400' : 'text-zinc-500'
                        }`}>
                          {exit.priceExecuted !== null ? (exit.priceDelta > 0 ? `+${exit.priceDelta.toFixed(5)}` : exit.priceDelta?.toFixed(5)) : 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Point Size</span>
                        <span className="text-zinc-400 mt-1 block">
                          {exit.pointSize !== null && exit.pointSize !== undefined ? exit.pointSize : 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Slippage Points</span>
                        {exit.slippagePoints !== null && exit.slippagePoints !== undefined ? (
                          <span className={`font-bold mt-1 block ${
                            exit.slippageType === 'Adverse' 
                              ? 'text-red-400' 
                              : exit.slippageType === 'Favorable' 
                              ? 'text-emerald-400' 
                              : 'text-zinc-500'
                          }`}>
                            {exit.slippagePoints} points
                          </span>
                        ) : (
                          <span className="text-zinc-500 mt-1 block italic text-[10px]">N/A</span>
                        )}
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Classification</span>
                        <span className={`font-semibold mt-1 block ${
                          exit.slippageType === 'Adverse' 
                            ? 'text-red-400' 
                            : exit.slippageType === 'Favorable' 
                            ? 'text-emerald-400' 
                            : 'text-zinc-500'
                        }`}>
                          {exit.slippageType || 'N/A'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] text-zinc-500 block">Execution Latency</span>
                        <span className="text-zinc-300 font-semibold mt-1 block">
                          {exit.executionLatencyMs !== null && exit.executionLatencyMs !== undefined ? `${exit.executionLatencyMs} ms` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-zinc-500 italic text-xs">
                      No exit execution data parsed (active open position or flat import history).
                    </div>
                  )}
                </div>
              </div>
              {entry.rejection?.isRejected ? (
                <div className="rounded-xl border border-red-950 bg-red-950/10 p-6 space-y-4">
                  <div className="flex items-center gap-2 border-b border-red-950 pb-3">
                    <AlertTriangle className="h-4.5 w-4.5 text-red-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-400">Trade Request Rejected</h4>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-3 text-xs font-mono">
                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Rejection Reason</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block">
                        {entry.rejection.reason}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        Raw log: "{entry.rejection.rawReason || 'N/A'}"
                      </span>
                    </div>

                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Rejected By</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block">
                        {entry.rejection.rejectedBy}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        System component or Desk
                      </span>
                    </div>

                    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-4">
                      <span className="text-[10px] text-red-400 block uppercase font-semibold">Failed Stage</span>
                      <span className="text-lg font-bold text-red-200 mt-1 block font-semibold text-red-400">
                        {entry.rejection.failedStage}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        Last successful: {entry.rejection.lastSuccessfulStage}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400 bg-red-950/5 p-4 rounded-lg border border-red-950/30">
                    <p className="font-semibold text-red-300">Failure Explanation:</p>
                    <p className="mt-1 leading-relaxed">
                      The client request successfully completed the <strong>{entry.rejection.lastSuccessfulStage}</strong> stage, but failed at <strong>{entry.rejection.failedStage}</strong> after being rejected by <strong>{entry.rejection.rejectedBy}</strong>. Deal execution did not occur, and no market position was created.
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
                        {summary.netSlippage?.slippagePoints ?? 0} points {summary.netSlippage?.slippageType || 'Zero'}
                      </span>
                      <div className="text-[9px] text-zinc-500 space-y-0.5 mt-2 pt-2 border-t border-zinc-900/50">
                        <div>Entry: {summary.entryExecution?.slippagePoints ?? 0} {summary.entryExecution?.slippageType === 'Adverse' ? 'Adverse' : summary.entryExecution?.slippageType === 'Favorable' ? 'Favorable' : 'Zero'}</div>
                        {summary.exitExecution && (
                          <>
                            <div>Exit: {summary.exitExecution.slippagePoints} {summary.exitExecution.slippageType === 'Adverse' ? 'Adverse' : summary.exitExecution.slippageType === 'Favorable' ? 'Favorable' : 'Zero'}</div>
                            <div className="text-amber-400/80 font-medium">Brokeree Applied: {summary.exitExecution.slippagePoints} points Adverse</div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-950/20 border border-zinc-900/50 rounded-lg p-4">
                      <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Cumulative Execution Latency</span>
                      <span className="text-xl font-bold text-zinc-100 mt-1 block font-mono">
                        {summary.cumulativeLatency !== undefined && summary.cumulativeLatency !== null 
                          ? `${summary.cumulativeLatency.toFixed(0)} ms` 
                          : `${summary.cumulativeLatencyMs || 0} ms`}
                      </span>
                      <div className="text-[9px] text-zinc-500 space-y-0.5 mt-2 pt-2 border-t border-zinc-900/50">
                        <div>Entry Latency: {summary.entryLatency !== null && summary.entryLatency !== undefined ? `${summary.entryLatency.toFixed(0)} ms` : 'N/A'}</div>
                        {summary.exitExecution && (
                          <div>Exit Latency: {summary.exitLatency !== null && summary.exitLatency !== undefined ? `${summary.exitLatency.toFixed(0)} ms` : 'N/A'}</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-950/20 border border-zinc-900/50 rounded-lg p-4">
                      <span className="text-[10px] text-zinc-500 block uppercase font-semibold">Average Execution Latency</span>
                      <span className="text-xl font-bold text-zinc-300 mt-1 block font-mono">
                        {summary.averageLatency !== undefined && summary.averageLatency !== null 
                          ? `${summary.averageLatency.toFixed(0)} ms` 
                          : `${(exit ? ((entry.executionLatencyMs + exit.executionLatencyMs) / 2) : entry.executionLatencyMs).toFixed(0)} ms`}
                      </span>
                      <span className="text-[9px] text-zinc-500 block mt-1">
                        Mean execution processing delay
                      </span>
                    </div>
                  </div>
                </div>
              )}

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
              <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
                <FileText className="h-4.5 w-4.5 text-zinc-400" />
                <h3 className="text-sm font-semibold tracking-tight text-zinc-200">AI Incident Investigation Report</h3>
              </div>

              {latestAiReport ? (
                <div className="text-xs text-zinc-300 leading-relaxed font-sans space-y-4 whitespace-pre-wrap">
                  {latestAiReport.response}
                </div>
              ) : (
                <div className="py-12 text-center space-y-4">
                  <HelpCircle className="mx-auto h-8 w-8 text-zinc-700" />
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-300">AI Report not generated yet</h4>
                    <p className="text-[10px] text-zinc-500 mt-1 max-w-sm mx-auto">
                      Invoke the AI operations assistant to generate a structured timeline investigation.
                    </p>
                  </div>
                  <button
                    onClick={() => analyzeMutation.mutate()}
                    disabled={analyzeMutation.isPending}
                    className="rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition"
                  >
                    {analyzeMutation.isPending ? 'Generating Report...' : 'Run AI Compliance Check'}
                  </button>
                </div>
              )}
            </div>

            {/* AI Chat Feed */}
            <div className="lg:col-span-5 flex flex-col h-[500px] rounded-xl border border-zinc-900 bg-zinc-900/10 overflow-hidden">
              <div className="border-b border-zinc-900 bg-zinc-950/40 px-4 py-3 flex items-center gap-2 shrink-0">
                <MessageSquare className="h-4 w-4 text-zinc-400" />
                <span className="text-xs font-semibold tracking-tight text-zinc-200">Operations Assistant Chat</span>
              </div>

              {/* Message History Feed */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-sans">
                {!latestAiReport ? (
                  <div className="h-full flex items-center justify-center text-zinc-650 text-center p-6">
                    Analyze the transaction first to unlock follow-up chat support.
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-550 text-center p-6 italic">
                    Ask follow-up operations questions (e.g. "why did dealer #5 accept gold at 2352?")
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col max-w-[85%] rounded-lg p-3 ${
                        msg.role === 'user'
                          ? 'bg-zinc-900 border border-zinc-800 text-zinc-100 ml-auto'
                          : 'bg-zinc-950 border border-zinc-900 text-zinc-300 mr-auto'
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
                  placeholder="Ask a compliance question..."
                  disabled={!latestAiReport || chatMutation.isPending}
                  className="flex-1 rounded-lg border border-zinc-900 bg-zinc-950/50 px-3 py-2 text-xs text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-800 transition disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || !latestAiReport || chatMutation.isPending}
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
