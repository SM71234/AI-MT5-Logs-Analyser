import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, User, CreditCard, DollarSign, Activity, ArrowRightLeft, ShieldAlert, CheckCircle, Clock, FileSpreadsheet } from 'lucide-react';

interface Broker {
  id: string;
  name: string;
  serverAddress: string;
  port: number;
  managerLogin: string;
  status: 'CONNECTED' | 'DISCONNECTED';
}

interface ClientProfile {
  login: string;
  name: string;
  group: string;
  leverage: number;
  balance: number;
  equity: number;
  currency: string;
}

interface Trade {
  ticket: string;
  positionId: string;
  login: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  volume: number;
  priceRequested: number;
  priceExecuted: number;
  slippagePips: number;
  
  // Dynamic Slippage Analysis fields
  rawPriceDifference?: number;
  digits?: number | null;
  pointSize?: number | null;
  slippagePoints?: number | null;
  slippageType?: 'Adverse' | 'Favorable' | 'Zero';
  latencyMs?: number;
  executionAnalysis?: any;

  timeRequested: string;
  timeExecuted: string;
  durationSeconds: number;
  comment: string;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
}

export default function ClientsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createInvestigationMutation = useMutation({
    mutationFn: async (vars: { brokerId: string; login: string; ticket: string }) => {
      const res = await fetch('/api/v1/investigations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(vars),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to start investigation');
      return body.data as { id: string };
    },
    onSuccess: (data) => {
      navigate(`/investigations/${data.id}`);
    },
    onError: (error: any) => {
      alert(`Investigation Error: ${error.message}`);
    },
  });

  const handleExportCSV = () => {
    if (!filteredTrades || filteredTrades.length === 0) return;
    
    const headers = [
      'Ticket/PositionID',
      'Symbol',
      'Action',
      'Volume (Lots)',
      'Requested Price',
      'Executed Price',
      'PnL (USD)',
      'Slippage (Points)',
      'Slippage Type',
      'Execution Latency (ms)',
      'Comment'
    ];
    
    const rows = filteredTrades.map((t) => [
      t.ticket,
      t.symbol,
      t.action,
      t.volume,
      t.priceRequested,
      t.priceExecuted,
      t.profit,
      t.slippagePoints !== null && t.slippagePoints !== undefined ? t.slippagePoints : 'N/A',
      t.slippageType || 'Zero',
      t.latencyMs !== undefined && t.latencyMs !== null ? t.latencyMs : (t.durationSeconds * 1000),
      `"${(t.comment || '').replace(/"/g, '""')}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mt5_trades_export_${activeQuery?.login || 'client'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [selectedBrokerId, setSelectedBrokerId] = useState(() => sessionStorage.getItem('clients_selectedBrokerId') || '');
  const [searchLogin, setSearchLogin] = useState(() => sessionStorage.getItem('clients_searchLogin') || '');
  
  // Controls when queries are executed
  const [activeQuery, setActiveQuery] = useState<{ brokerId: string; login: string } | null>(() => {
    const saved = sessionStorage.getItem('clients_activeQuery');
    return saved ? JSON.parse(saved) : null;
  });

  // Sync search fields and query parameters to sessionStorage to preserve across tab transitions
  React.useEffect(() => {
    sessionStorage.setItem('clients_selectedBrokerId', selectedBrokerId);
  }, [selectedBrokerId]);

  React.useEffect(() => {
    sessionStorage.setItem('clients_searchLogin', searchLogin);
  }, [searchLogin]);

  React.useEffect(() => {
    if (activeQuery) {
      sessionStorage.setItem('clients_activeQuery', JSON.stringify(activeQuery));
    } else {
      sessionStorage.removeItem('clients_activeQuery');
    }
  }, [activeQuery]);

  const [tradeSearch, setTradeSearch] = useState('');
  const [tradeTypeTab, setTradeTypeTab] = useState<'executed' | 'rejected'>('executed');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);

  // Fetch brokers list for dropdown selection
  const { data: brokers } = useQuery<Broker[]>({
    queryKey: ['brokers'],
    queryFn: async () => {
      const res = await fetch('/api/v1/brokers', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to load brokers');
      const body = await res.json();
      return body.data;
    },
  });

  // Query Client Profile details
  const {
    data: clientProfile,
    isLoading: isLoadingProfile,
    error: profileError,
  } = useQuery<ClientProfile>({
    queryKey: ['client-profile', activeQuery],
    queryFn: async () => {
      if (!activeQuery) return null;
      const res = await fetch(`/api/v1/clients/search?brokerId=${activeQuery.brokerId}&login=${activeQuery.login}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Client profile not found');
      return body.data;
    },
    enabled: !!activeQuery,
    retry: false,
    staleTime: Infinity,
    gcTime: 15 * 60 * 1000,
  });

  // Query Client Trades history
  const {
    data: trades,
    isLoading: isLoadingTrades,
  } = useQuery<Trade[]>({
    queryKey: ['client-trades', activeQuery],
    queryFn: async () => {
      if (!activeQuery) return [];
      const res = await fetch(`/api/v1/trades?brokerId=${activeQuery.brokerId}&login=${activeQuery.login}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to load trades');
      return body.data;
    },
    enabled: !!activeQuery && !!clientProfile,
    retry: false,
    staleTime: Infinity,
    gcTime: 15 * 60 * 1000,
  });

  // Reset pagination and tab on query or trades reload
  React.useEffect(() => {
    setCurrentPage(1);
    setTradeSearch('');
    setTradeTypeTab('executed');
  }, [trades]);

  const filteredTrades = React.useMemo(() => {
    if (!trades) return [];
    
    // First, filter by Executed vs Rejected tab
    const tabFiltered = trades.filter((t) => {
      const isRejected = t.priceExecuted === 0 || t.priceExecuted === null || (t.comment && t.comment.toLowerCase().includes('reject'));
      return tradeTypeTab === 'rejected' ? isRejected : !isRejected;
    });

    // Then, filter by keyword search
    return tabFiltered.filter((t) => {
      const q = tradeSearch.toLowerCase().trim();
      if (!q) return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.ticket.toLowerCase().includes(q) ||
        (t.comment && t.comment.toLowerCase().includes(q))
      );
    });
  }, [trades, tradeSearch, tradeTypeTab]);

  const paginatedTrades = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredTrades.slice(start, end);
  }, [filteredTrades, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBrokerId || !searchLogin.trim()) return;
    
    const nextQuery = {
      brokerId: selectedBrokerId,
      login: searchLogin.trim(),
    };
    
    setActiveQuery(nextQuery);
    
    // Explicitly invalidate React Query cache to force a fresh REST API request to the MT5 gateway
    queryClient.invalidateQueries({ queryKey: ['client-profile', nextQuery] });
    queryClient.invalidateQueries({ queryKey: ['client-trades', nextQuery] });
  };

  const isSearchDisabled = !selectedBrokerId || !searchLogin.trim();

  return (
    <div className="relative z-10 flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Page Title */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Client Explorer</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Query account states and inspect recent order lifecycles across MT5 servers.
        </p>
      </div>

      {/* Search Input Card */}
      <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-5 backdrop-blur-sm shadow-md">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Select Broker
            </label>
            <select
              value={selectedBrokerId}
              onChange={(e) => setSelectedBrokerId(e.target.value)}
              className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-800 transition"
            >
              <option value="" className="bg-zinc-950">-- Choose MT5 Server --</option>
              {brokers?.map((b) => (
                <option key={b.id} value={b.id} className="bg-zinc-950">
                  {b.name} ({b.status === 'CONNECTED' ? '🟢 Online' : '⚪ Offline'})
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              MT5 Login ID
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchLogin}
                onChange={(e) => setSearchLogin(e.target.value)}
                placeholder="e.g. 2002"
                className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 py-2.5 pl-3 pr-10 text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-700">
                <Search className="h-4 w-4" />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSearchDisabled || isLoadingProfile}
            className="flex items-center justify-center gap-2 rounded-lg bg-zinc-100 px-4 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition duration-150 disabled:opacity-50 h-10 shrink-0"
          >
            {isLoadingProfile ? 'Loading...' : 'Search Client'}
          </button>
        </form>
      </div>

      {/* Profile error message */}
      {profileError && (
        <div className="rounded-xl border border-red-950 bg-red-950/10 p-5 text-xs text-red-400 flex items-start gap-3">
          <ShieldAlert className="h-4.5 w-4.5 shrink-0 mt-0.5" />
          <div>
            <h5 className="font-semibold mb-1">Search lookup failed</h5>
            <p>{profileError.message}</p>
          </div>
        </div>
      )}

      {/* Results View */}
      {clientProfile && !profileError ? (
        <div className="space-y-8">
          
          {/* Client Profile details */}
          <div className="grid gap-6 md:grid-cols-4">
            
            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-5 backdrop-blur-sm flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-850 bg-zinc-900/60 text-zinc-400">
                <User className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Holder Name</p>
                <h4 className="truncate text-sm font-semibold text-zinc-100">{clientProfile.name}</h4>
                <span className="text-[10px] font-mono text-zinc-500">ID: {clientProfile.login}</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-5 backdrop-blur-sm flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-850 bg-zinc-900/60 text-zinc-400">
                <DollarSign className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Balance</p>
                <h4 className="text-sm font-bold text-zinc-100">
                  {clientProfile.balance.toLocaleString()} <span className="text-xs font-normal text-zinc-400">{clientProfile.currency}</span>
                </h4>
                <span className="text-[10px] font-mono text-zinc-500">Group: {clientProfile.group}</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-5 backdrop-blur-sm flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-850 bg-zinc-900/60 text-zinc-400">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Equity</p>
                <h4 className="text-sm font-bold text-zinc-100">
                  {clientProfile.equity.toLocaleString()} <span className="text-xs font-normal text-zinc-400">{clientProfile.currency}</span>
                </h4>
                <span className="text-[10px] font-mono text-zinc-500">Leverage: 1:{clientProfile.leverage}</span>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-5 backdrop-blur-sm flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-850 bg-zinc-900/60 text-zinc-400">
                <Activity className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Broker status</p>
                <span className="inline-flex items-center gap-1.5 rounded bg-emerald-950/20 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-950 mt-1">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>Valid Session</span>
                </span>
              </div>
            </div>

          </div>

          {/* Trade Explorer Table */}
          <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 overflow-hidden shadow-md">
            <div className="border-b border-zinc-900 bg-zinc-950/40 px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4.5 w-4.5 text-zinc-500" />
                <h3 className="text-sm font-semibold tracking-tight text-zinc-200">
                  Trade Explorer — Reconstructed Positions
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={!filteredTrades || filteredTrades.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 transition disabled:opacity-30 h-8 shrink-0"
                  title="Export reconstructed positions to Excel CSV"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Export Excel</span>
                </button>
                {/* Local Search Input */}
                <div className="relative w-48 sm:w-60">
                  <input
                    type="text"
                    value={tradeSearch}
                    onChange={(e) => setTradeSearch(e.target.value)}
                    placeholder="Search symbol, ticket ID..."
                    className="block w-full rounded-md border border-zinc-850 bg-zinc-950/30 py-1.5 pl-2.5 pr-8 text-[11px] text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-700 transition"
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-zinc-600">
                    <Search className="h-3.5 w-3.5" />
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shrink-0">
                  {filteredTrades.length} Positions
                </span>
              </div>
            </div>

            {/* Tabs selector */}
            <div className="flex border-b border-zinc-900 bg-zinc-950/20 px-5 gap-4">
              <button
                type="button"
                onClick={() => { setTradeTypeTab('executed'); setCurrentPage(1); }}
                className={`py-3 px-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                  tradeTypeTab === 'executed'
                    ? 'border-emerald-500 text-zinc-100 font-semibold'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>Executed Trades</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold ${
                  tradeTypeTab === 'executed' ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-950/50' : 'bg-zinc-900 text-zinc-600'
                }`}>
                  {trades ? trades.filter(t => !(t.priceExecuted === 0 || t.priceExecuted === null || (t.comment && t.comment.toLowerCase().includes('reject')))).length : 0}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setTradeTypeTab('rejected'); setCurrentPage(1); }}
                className={`py-3 px-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                  tradeTypeTab === 'rejected'
                    ? 'border-red-500 text-zinc-100 font-semibold'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span>Rejected Trades</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-mono font-bold ${
                  tradeTypeTab === 'rejected' ? 'bg-red-950/30 text-red-400 border border-red-950/50' : 'bg-zinc-900 text-zinc-600'
                }`}>
                  {trades ? trades.filter(t => (t.priceExecuted === 0 || t.priceExecuted === null || (t.comment && t.comment.toLowerCase().includes('reject')))).length : 0}
                </span>
              </button>
            </div>

            {isLoadingTrades ? (
              <div className="flex justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-850 border-t-zinc-400" />
              </div>
            ) : filteredTrades && filteredTrades.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-900 bg-zinc-950/20 text-zinc-500 font-medium">
                        <th className="p-4">Ticket</th>
                        <th className="p-4">Symbol</th>
                        <th className="p-4">Action</th>
                        <th className="p-4 text-right">Volume</th>
                        <th className="p-4 text-right">Requested</th>
                        <th className="p-4 text-right">Executed</th>
                        <th className="p-4 text-right">PnL</th>
                        <th className="p-4 text-right">Slippage (Points)</th>
                        <th className="p-4 text-right">Execution Latency(Delay)</th>
                        <th className="p-4">Comment</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/50">
                      {paginatedTrades.map((trade) => {
                        const latencyVal = trade.executionAnalysis?.averageLatency ?? trade.latencyMs ?? (trade.durationSeconds * 1000);
                        const hasHighLatency = latencyVal >= 300;

                        return (
                          <tr key={trade.ticket} className="hover:bg-zinc-900/10 transition">
                            <td className="p-4 font-mono font-medium text-zinc-400">{trade.ticket}</td>
                            <td className="p-4 font-semibold text-zinc-200">{trade.symbol}</td>
                            <td className="p-4">
                              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                trade.action === 'BUY'
                                  ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-950/50'
                                  : 'bg-red-950/30 text-red-400 border border-red-950/50'
                              }`}>
                                {trade.action}
                              </span>
                            </td>
                            <td className="p-4 text-right font-mono">{trade.volume.toFixed(2)}</td>
                            <td className="p-4 text-right font-mono text-zinc-400">
                              {trade.priceRequested !== undefined && trade.priceRequested !== null && trade.priceRequested !== 0
                                ? trade.priceRequested.toFixed(trade.symbol.includes('JPY') ? 3 : 5)
                                : 'N/A'}
                            </td>
                            <td className="p-4 text-right font-mono font-semibold text-zinc-100">
                              {trade.priceExecuted !== undefined && trade.priceExecuted !== null && trade.priceExecuted !== 0
                                ? trade.priceExecuted.toFixed(trade.symbol.includes('JPY') ? 3 : 5)
                                : 'N/A'}
                            </td>
                            
                            {/* PnL Column */}
                            <td className={`p-4 text-right font-mono font-bold ${
                              trade.profit > 0 ? 'text-emerald-400' : trade.profit < 0 ? 'text-red-400' : 'text-zinc-500'
                            }`}>
                              {trade.profit > 0 ? `+$${trade.profit.toFixed(2)}` : trade.profit < 0 ? `-$${Math.abs(trade.profit).toFixed(2)}` : '$0.00'}
                            </td>

                            {/* Slippage Points + Raw Price Diff */}
                            <td className="p-4 text-right font-mono font-medium">
                              {trade.executionAnalysis?.netSlippage ? (
                                <div className="flex flex-col items-end">
                                  <span className={
                                    trade.executionAnalysis.netSlippage.slippageType === 'Adverse' 
                                      ? 'text-red-400 font-semibold' 
                                      : trade.executionAnalysis.netSlippage.slippageType === 'Favorable' 
                                      ? 'text-emerald-400 font-semibold' 
                                      : 'text-zinc-500'
                                  }>
                                    {trade.executionAnalysis.netSlippage.slippageType === 'Adverse' ? '-' : trade.executionAnalysis.netSlippage.slippageType === 'Favorable' ? '+' : ''}
                                    {trade.executionAnalysis.netSlippage.slippagePoints} pts {trade.executionAnalysis.netSlippage.slippageType === 'Adverse' ? 'Adverse' : trade.executionAnalysis.netSlippage.slippageType === 'Favorable' ? 'Favorable' : 'Zero'}
                                  </span>
                                  {trade.executionAnalysis.exitExecution ? (
                                    <span className="text-[9px] text-zinc-500 font-normal">
                                      Entry: {trade.executionAnalysis.entryExecution.slippagePoints}{trade.executionAnalysis.entryExecution.slippageType === 'Adverse' ? 'A' : trade.executionAnalysis.entryExecution.slippageType === 'Favorable' ? 'F' : 'Z'} | Exit: {trade.executionAnalysis.exitExecution.slippagePoints}{trade.executionAnalysis.exitExecution.slippageType === 'Adverse' ? 'A' : trade.executionAnalysis.exitExecution.slippageType === 'Favorable' ? 'F' : 'Z'}
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-zinc-500 font-normal">
                                      Entry: {trade.executionAnalysis.entryExecution.slippagePoints}{trade.executionAnalysis.entryExecution.slippageType === 'Adverse' ? 'A' : trade.executionAnalysis.entryExecution.slippageType === 'Favorable' ? 'F' : 'Z'}
                                    </span>
                                  )}
                                </div>
                              ) : trade.slippagePoints !== undefined && trade.slippagePoints !== null ? (
                                <div className="flex flex-col items-end">
                                  <span className={
                                    trade.slippageType === 'Adverse' 
                                      ? 'text-red-400 font-semibold' 
                                      : trade.slippageType === 'Favorable' 
                                      ? 'text-emerald-400 font-semibold' 
                                      : 'text-zinc-500'
                                  }>
                                    {trade.slippageType === 'Adverse' ? '-' : trade.slippageType === 'Favorable' ? '+' : ''}
                                    {trade.slippagePoints} pts
                                  </span>
                                  <span className="text-[9px] text-zinc-500 font-normal">
                                    diff: {trade.rawPriceDifference !== undefined && trade.rawPriceDifference > 0 ? `+${trade.rawPriceDifference.toFixed(4)}` : trade.rawPriceDifference?.toFixed(4)}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-end">
                                  <span className="text-zinc-500">N/A</span>
                                  <span className="text-[9px] text-zinc-500 font-normal">
                                    diff: {trade.rawPriceDifference !== undefined ? (trade.rawPriceDifference > 0 ? `+${trade.rawPriceDifference.toFixed(4)}` : trade.rawPriceDifference.toFixed(4)) : 'N/A'}
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Execution Latency highlights */}
                            <td className={`p-4 text-right font-mono font-medium ${
                              hasHighLatency ? 'text-red-400' : 'text-zinc-400'
                            }`}>
                              <div className="flex flex-col items-end justify-center">
                                <div className="flex items-center justify-end gap-1.5">
                                  {hasHighLatency && <Clock className="h-3 w-3 text-red-500 animate-pulse" />}
                                  <span>
                                    {trade.executionAnalysis?.averageLatency !== undefined && trade.executionAnalysis?.averageLatency !== null
                                      ? `${trade.executionAnalysis.averageLatency.toFixed(0)} ms (avg)` 
                                      : `${(trade.latencyMs ?? trade.durationSeconds * 1000).toFixed(0)} ms`}
                                  </span>
                                </div>
                                {trade.executionAnalysis?.exitExecution && (
                                  <span className="text-[9px] text-zinc-500 font-normal mt-0.5">
                                    cum: {trade.executionAnalysis.cumulativeLatency.toFixed(0)} ms
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="p-4 text-zinc-500 italic max-w-[150px] truncate">{trade.comment}</td>
                            
                            <td className="p-4 text-right">
                              <button
                                onClick={() => {
                                  setSavingTicketId(trade.ticket);
                                  createInvestigationMutation.mutate({
                                    brokerId: activeQuery!.brokerId,
                                    login: activeQuery!.login,
                                    ticket: trade.ticket
                                  }, {
                                    onSettled: () => setSavingTicketId(null)
                                  });
                                }}
                                disabled={createInvestigationMutation.isPending}
                                className="inline-flex items-center gap-1 rounded bg-zinc-900 border border-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 transition disabled:opacity-50"
                              >
                                <span>{createInvestigationMutation.isPending && savingTicketId === trade.ticket ? 'Saving...' : 'Investigate'}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="border-t border-zinc-900 bg-zinc-950/20 px-5 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-[11px] text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span>Show</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="rounded border border-zinc-850 bg-zinc-950/40 p-1 text-[11px] text-zinc-300 outline-none focus:border-zinc-800"
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size} className="bg-zinc-950">
                          {size}
                        </option>
                      ))}
                    </select>
                    <span>entries per page</span>
                    <span className="text-zinc-600 font-mono ml-2">
                      | Showing {Math.min(filteredTrades.length, (currentPage - 1) * pageSize + 1)}-{Math.min(filteredTrades.length, currentPage * pageSize)} of {filteredTrades.length} entries
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((c) => Math.max(c - 1, 1))}
                      className="rounded border border-zinc-850 bg-zinc-950/20 px-2.5 py-1 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30 transition font-medium"
                    >
                      Previous
                    </button>
                    {Array.from({ length: totalPages }).map((_, idx) => {
                      const pageNum = idx + 1;
                      const isCurrent = pageNum === currentPage;
                      if (
                        totalPages > 6 &&
                        pageNum !== 1 &&
                        pageNum !== totalPages &&
                        Math.abs(pageNum - currentPage) > 1
                      ) {
                        if (pageNum === 2 || pageNum === totalPages - 1) {
                          return <span key={pageNum} className="px-1 text-zinc-700 font-bold">...</span>;
                        }
                        return null;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`rounded px-2.5 py-1 font-medium transition ${
                            isCurrent
                              ? 'bg-zinc-100 text-zinc-950 border border-zinc-100 font-semibold'
                              : 'border border-zinc-850 bg-zinc-950/20 hover:bg-zinc-900 hover:text-zinc-200'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    <button
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((c) => Math.min(c + 1, totalPages))}
                      className="rounded border border-zinc-850 bg-zinc-950/20 px-2.5 py-1 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30 transition font-medium"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-zinc-500 text-xs">
                No matching trade transactions found for this account.
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-900 bg-zinc-900/5 p-16 text-center">
          <User className="mx-auto h-8 w-8 text-zinc-700 mb-3" />
          <h4 className="text-xs font-semibold text-zinc-400">Search Workspace Empty</h4>
          <p className="mt-1 text-xs text-zinc-600 max-w-sm mx-auto">
            Configure a broker connection, select it, and query an MT5 account ID to load profile balances and explore execution pips.
          </p>
        </div>
      )}
    </div>
  );
}
