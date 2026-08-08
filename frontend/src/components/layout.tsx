import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, Database, ShieldAlert, LogOut, Terminal, Settings, Users } from 'lucide-react';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Brokers', href: '/brokers', icon: Database },
    { name: 'Clients', href: '/clients', icon: Users },
    { name: 'Investigations', href: '/investigations', icon: ShieldAlert },
    { name: 'Settings', href: '/settings', icon: Settings, disabled: true },
  ];

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Background grid line effects */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f0f11_1px,transparent_1px),linear-gradient(to_bottom,#0f0f11_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

      {/* Workspace Sidebar */}
      <aside className="relative z-10 flex h-full w-64 flex-col border-r border-zinc-900 bg-zinc-950/60 backdrop-blur-md">
        {/* Brand logo header */}
        <div className="flex h-16 items-center gap-3 border-b border-zinc-900 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-100 shadow-sm">
            <Terminal className="h-4 w-4 text-zinc-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              MT5 AI Analyzer
            </h1>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-mono">
              Broker Portal
            </p>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 space-y-1.5 px-4 py-6">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;

            if (item.disabled) {
              return (
                <div
                  key={item.name}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-600 transition"
                  title="Coming soon in next Phase"
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.name}</span>
                  <span className="ml-auto rounded bg-zinc-900 border border-zinc-850 px-1 py-0.2 text-[8px] font-medium font-mono text-zinc-700">
                    Phase {item.name === 'Investigations' ? '2' : '5'}
                  </span>
                </div>
              );
            }

            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition duration-150 ${
                  isActive
                    ? 'bg-zinc-900 text-zinc-50 border border-zinc-800'
                    : 'text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-zinc-200' : 'text-zinc-500'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer profile info & logouts */}
        <div className="border-t border-zinc-900 p-4 bg-zinc-950/40">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-zinc-300">{user?.name}</p>
              <p className="truncate text-[10px] text-zinc-500 font-mono">{user?.email}</p>
            </div>
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold font-mono text-zinc-500 border border-zinc-800">
              {user?.role}
            </span>
          </div>

          <button
            onClick={logout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900/10 px-3 py-2 text-xs font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition duration-150"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main viewport area */}
      <div className="relative flex flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
