import { useAuth } from '../hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { Shield, AlertCircle, Users, Database } from 'lucide-react';

interface Broker {
  id: string;
  name: string;
  serverAddress: string;
  port: number;
  managerLogin: string;
  status: 'CONNECTED' | 'DISCONNECTED';
}

export default function DashboardPage() {
  const { accessToken } = useAuth();

  const { data: brokers } = useQuery<Broker[]>({
    queryKey: ['brokers'],
    queryFn: async () => {
      const res = await fetch('/api/v1/brokers', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error('Failed to fetch brokers');
      const body = await res.json();
      return body.data;
    },
  });

  const totalConfigured = brokers?.length || 0;
  const totalConnected = brokers?.filter((b) => b.status === 'CONNECTED').length || 0;

  return (
    <div className="relative z-10 flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-8">
          
          {/* Welcome section */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Workspace Dashboard</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Analyze client transactions, correlate server records, and query AI incident reports.
            </p>
          </div>

          {/* Metric cards grid */}
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Connected Brokers
                </span>
                <Database className="h-4.5 w-4.5 text-zinc-500" />
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-zinc-100">{totalConnected}</span>
                <span className="text-xs text-zinc-500 font-medium">/ {totalConfigured} active</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">Configure connections under Broker settings.</p>
            </div>

            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Investigations
                </span>
                <Shield className="h-4.5 w-4.5 text-zinc-500" />
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-zinc-100">0</span>
                <span className="text-xs text-zinc-500 font-medium">active</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">Client complaints and trade audit cases.</p>
            </div>

            <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Security Logins
                </span>
                <Users className="h-4.5 w-4.5 text-zinc-500" />
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-zinc-100">1</span>
                <span className="text-xs text-zinc-500 font-medium">current session</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">User operations logged in Audit logs.</p>
            </div>
          </div>

          {/* Phase 1 placeholder alerts */}
          <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-6 backdrop-blur-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-zinc-900 pb-4">
              <AlertCircle className="h-5 w-5 text-zinc-400" />
              <h3 className="text-sm font-semibold tracking-tight text-zinc-200">
                Phase 1 Development Notice
              </h3>
            </div>
            <div className="text-xs text-zinc-400 leading-relaxed space-y-2">
              <p>
                Authentication and core infrastructure services have been established. Currently:
              </p>
              <ul className="list-disc list-inside pl-1 space-y-1 text-zinc-500">
                <li>NestJS backend is serving endpoints on <code>/api/v1/auth/*</code></li>
                <li>Prisma database models are loaded</li>
                <li>Vite is running React 19 and styling components using Tailwind CSS</li>
              </ul>
              <p className="pt-2">
                Next steps will involve implementing <strong>Broker Management</strong> CRUD endpoints, credentials encryption, and multi-broker dashboard interfaces.
              </p>
            </div>
          </div>

    </div>
  );
}
