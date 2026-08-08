import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight, Database, Calendar } from 'lucide-react';

interface SavedCase {
  id: string;
  ticketId: string;
  clientLogin: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'RESOLVED';
  createdAt: string;
  broker: { name: string };
  user: { name: string };
}

export default function InvestigationsListPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();

  // Fetch all saved cases from database
  const { data: cases, isLoading } = useQuery<SavedCase[]>({
    queryKey: ['investigations'],
    queryFn: async () => {
      const res = await fetch('/api/v1/investigations', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch investigations');
      const body = await res.json();
      return body.data;
    },
  });

  return (
    <div className="relative z-10 flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Audit Investigations</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Review saved client trade dispute investigations and active AI audits.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-850 border-t-zinc-400" />
        </div>
      ) : cases && cases.length > 0 ? (
        <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 bg-zinc-950/20 text-zinc-500 font-medium">
                  <th className="p-4">Ticket</th>
                  <th className="p-4">Incident Title</th>
                  <th className="p-4">Broker Server</th>
                  <th className="p-4">Client ID</th>
                  <th className="p-4">Created Date</th>
                  <th className="p-4">Created By</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">View File</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/50">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-900/10 transition">
                    <td className="p-4 font-mono font-medium text-zinc-400">#{c.ticketId}</td>
                    <td className="p-4 font-semibold text-zinc-200">{c.title}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <Database className="h-3.5 w-3.5 text-zinc-650" />
                        <span>{c.broker?.name}</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono text-zinc-400">{c.clientLogin}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                    </td>
                    <td className="p-4 text-zinc-400">{c.user?.name}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold border ${
                        c.status === 'OPEN'
                          ? 'bg-amber-950/20 text-amber-400 border-amber-950/50'
                          : 'bg-emerald-950/20 text-emerald-400 border-emerald-950/50'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${c.status === 'OPEN' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                        <span>{c.status}</span>
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => navigate(`/investigations/${c.id}`)}
                        className="inline-flex items-center gap-1.5 rounded bg-zinc-100 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition"
                      >
                        <span>Open Workspace</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-900 bg-zinc-900/5 p-16 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-zinc-700 mb-3" />
          <h4 className="text-xs font-semibold text-zinc-400">No active cases</h4>
          <p className="mt-1 text-xs text-zinc-650 max-w-sm mx-auto">
            Saved investigations and client dispute timelines will appear here once saved from the Client Explorer page.
          </p>
        </div>
      )}
    </div>
  );
}
