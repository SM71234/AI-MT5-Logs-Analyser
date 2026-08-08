import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, Plus, Trash2, ShieldAlert, Server, Network, User, Play, Square, Wifi, Check, AlertTriangle } from 'lucide-react';

interface Broker {
  id: string;
  name: string;
  serverAddress: string;
  port: number;
  managerLogin: string;
  status: 'CONNECTED' | 'DISCONNECTED';
  createdAt: string;
}

export default function BrokersPage() {
  const { user, accessToken } = useAuth();
  const queryClient = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [port, setPort] = useState(443);
  const [managerLogin, setManagerLogin] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  
  // Test connection status for form inputs
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  // Saved connections status messages keyed by brokerId
  const [savedTestResult, setSavedTestResult] = useState<Record<string, { success: boolean; message: string }>>({});

  const isAdmin = user?.role === 'ADMIN';

  // Fetch all brokers configurations
  const { data: brokers, isLoading } = useQuery<Broker[]>({
    queryKey: ['brokers'],
    queryFn: async () => {
      const res = await fetch('/api/v1/brokers', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch broker configurations');
      const body = await res.json();
      return body.data;
    },
  });

  // Create broker connection mutation
  const createMutation = useMutation({
    mutationFn: async (newBroker: any) => {
      const res = await fetch('/api/v1/brokers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(newBroker),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to create broker');
      return body.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokers'] });
      setShowAddForm(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err.message);
    },
  });

  // Delete broker connection mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/brokers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || 'Failed to delete broker');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  // In-flight connection test mutation (for unsaved form details)
  const testInFlightMutation = useMutation({
    mutationFn: async (creds: any) => {
      const res = await fetch('/api/v1/brokers/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(creds),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to validate parameters');
      return body;
    },
    onSuccess: (data) => {
      setTestResult({
        success: data.success,
        message: data.message,
      });
    },
    onError: (err: any) => {
      setTestResult({
        success: false,
        message: err.message,
      });
    },
  });

  // Saved connection test mutation
  const testSavedMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/brokers/${id}/test-connection`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to test connection');
      return body;
    },
    onSuccess: (data, id) => {
      setSavedTestResult((prev) => ({
        ...prev,
        [id]: { success: data.success, message: data.message },
      }));
    },
    onError: (err: any, id) => {
      setSavedTestResult((prev) => ({
        ...prev,
        [id]: { success: false, message: err.message },
      }));
    },
  });

  // Connect broker mutation
  const connectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/brokers/${id}/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to establish connection');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  // Disconnect broker mutation
  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/brokers/${id}/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Failed to terminate connection');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brokers'] });
    },
  });

  const resetForm = () => {
    setName('');
    setServerAddress('');
    setPort(443);
    setManagerLogin('');
    setPassword('');
    setFormError(null);
    setTestResult(null);
  };

  const handleTestInFlight = () => {
    setFormError(null);
    setTestResult(null);

    if (!serverAddress || !managerLogin || !password) {
      setFormError('Please fill in server address, login, and password to test connection');
      return;
    }

    testInFlightMutation.mutate({
      serverAddress,
      port: Number(port),
      managerLogin,
      password,
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name || !serverAddress || !managerLogin || !password) {
      setFormError('Please fill in all fields');
      return;
    }

    createMutation.mutate({
      name,
      serverAddress,
      port: Number(port),
      managerLogin,
      password,
    });
  };

  return (
    <div className="relative z-10 flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Broker Integrations</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Configure server addresses and manager logins for multiple MT5 brokers.
          </p>
        </div>

        {isAdmin && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition duration-150"
          >
            <Plus className="h-4 w-4" />
            <span>Add Broker</span>
          </button>
        )}
      </div>

      {/* Non-Admin restrictions banner */}
      {!isAdmin && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-900/10 p-4 text-xs text-zinc-400">
          <ShieldAlert className="h-4 w-4 text-zinc-500 shrink-0" />
          <span>
            Only administrators are authorized to add, modify, or delete broker connection profiles. Supports and dealers have read-only access.
          </span>
        </div>
      )}

      {/* Add Broker Form (Admin only) */}
      {showAddForm && isAdmin && (
        <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 backdrop-blur-sm max-w-xl shadow-lg">
          <h3 className="text-sm font-semibold tracking-tight text-zinc-200 mb-4">
            New MT5 Broker Connection
          </h3>

          <form onSubmit={handleAddSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-red-950 bg-red-950/20 p-3 text-xs text-red-400 font-medium">
                {formError}
              </div>
            )}

            {testResult && (
              <div className={`rounded-lg border p-3 text-xs font-medium flex items-center gap-2.5 ${
                testResult.success
                  ? 'border-emerald-950 bg-emerald-950/20 text-emerald-400'
                  : 'border-red-950 bg-red-950/20 text-red-400'
              }`}>
                {testResult.success ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Connection Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Broker Live"
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  MT5 Server IP / Address
                </label>
                <input
                  type="text"
                  value={serverAddress}
                  onChange={(e) => setServerAddress(e.target.value)}
                  placeholder="e.g. mt5.acme.com"
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-100 outline-none focus:border-zinc-800 transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Manager Login ID
                </label>
                <input
                  type="text"
                  value={managerLogin}
                  onChange={(e) => setManagerLogin(e.target.value)}
                  placeholder="e.g. 10002"
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Manager Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/40 p-2.5 text-xs text-zinc-100 placeholder-zinc-700 outline-none focus:border-zinc-800 transition"
              />
            </div>

            <div className="flex justify-between items-center pt-2">
              {/* Test Connection Button */}
              <button
                type="button"
                onClick={handleTestInFlight}
                disabled={testInFlightMutation.isPending}
                className="rounded-lg border border-zinc-900 bg-zinc-900/10 px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100 transition disabled:opacity-50"
              >
                {testInFlightMutation.isPending ? 'Testing...' : 'Test Connection'}
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
                  }}
                  className="rounded-lg border border-zinc-900 bg-zinc-900/30 px-3.5 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 transition disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Saving...' : 'Save Connection'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Main List Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-850 border-t-zinc-400" />
        </div>
      ) : brokers && brokers.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {brokers.map((broker) => {
            const isConnected = broker.status === 'CONNECTED';
            const testInfo = savedTestResult[broker.id];

            return (
              <div
                key={broker.id}
                className={`group relative rounded-xl border bg-zinc-900/10 p-5 backdrop-blur-sm shadow-md transition duration-150 ${
                  isConnected ? 'border-zinc-800' : 'border-zinc-900 hover:border-zinc-850'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-850 bg-zinc-900/40">
                      <Database className="h-4 w-4 text-zinc-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-200">{broker.name}</h4>
                      <span className="inline-flex items-center gap-1 rounded bg-zinc-900/60 px-1.5 py-0.2 text-[8px] font-mono border mt-0.5 border-zinc-850">
                        {/* Status Light */}
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
                        }`} />
                        <span className={isConnected ? 'text-emerald-400' : 'text-zinc-500'}>
                          {broker.status}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {/* Connect / Disconnect Buttons */}
                    {isConnected ? (
                      <button
                        onClick={() => disconnectMutation.mutate(broker.id)}
                        disabled={disconnectMutation.isPending}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900/20 text-zinc-400 hover:text-amber-400 hover:bg-amber-950/20 transition duration-150"
                        title="Disconnect session"
                      >
                        <Square className="h-3 w-3 fill-current" />
                      </button>
                    ) : (
                      <button
                        onClick={() => connectMutation.mutate(broker.id)}
                        disabled={connectMutation.isPending}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900/20 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-950/20 transition duration-150"
                        title="Establish session"
                      >
                        <Play className="h-3 w-3 fill-current" />
                      </button>
                    )}

                    {isAdmin && (
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this broker connection?')) {
                            deleteMutation.mutate(broker.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-900 bg-zinc-900/20 text-zinc-500 hover:text-red-400 hover:bg-red-950/20 hover:border-red-950/40 transition duration-150"
                        title="Delete connection"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Server info list */}
                <div className="mt-5 space-y-2 border-t border-zinc-900/60 pt-4 text-[11px] text-zinc-400">
                  <div className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span className="truncate">{broker.serverAddress}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span>Port: {broker.port}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                    <span>Manager Login: {broker.managerLogin}</span>
                  </div>
                </div>

                {/* Test Connection Button & Result Alert */}
                <div className="mt-4 pt-3 border-t border-zinc-900/30 flex flex-col gap-2">
                  <button
                    onClick={() => testSavedMutation.mutate(broker.id)}
                    disabled={testSavedMutation.isPending}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-zinc-950 py-1.5 text-[10px] font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition"
                  >
                    <Wifi className="h-3 w-3" />
                    <span>Test MT5 Server Connection</span>
                  </button>

                  {testInfo && (
                    <div className={`rounded p-2 text-[9px] font-medium ${
                      testInfo.success
                        ? 'bg-emerald-950/20 text-emerald-400 border border-emerald-950/40'
                        : 'bg-red-950/20 text-red-400 border border-red-950/40'
                    }`}>
                      {testInfo.message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-900 bg-zinc-900/5 p-12 text-center">
          <Database className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
          <h4 className="text-xs font-semibold text-zinc-300">No brokers configured</h4>
          <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
            Get started by adding your first MetaTrader 5 server configurations.
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Configure Broker</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
