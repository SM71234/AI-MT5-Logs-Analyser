import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { KeyRound, Mail, AlertTriangle, Eye, EyeOff, UserCheck, CheckCircle } from 'lucide-react';

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Login] Form submit triggered. isRegistering:', isRegistering);
    console.log('[Login] Inputs - Email:', email, 'Password length:', password.length, 'Name:', name);
    setError(null);
    setSuccess(null);

    if (!email || !password || (isRegistering && !name)) {
      console.warn('[Login] Submission blocked: missing fields.');
      setError('Please fill in all fields');
      return;
    }

    try {
      if (isRegistering) {
        console.log('[Login] Dispatching registration API call...');
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const body = await res.json();
        if (!res.ok) {
          console.error('[Login] Registration API error:', body);
          throw new Error(body.message || 'Registration failed');
        }
        console.log('[Login] Registration success.');
        setSuccess('Account created successfully! You can now sign in.');
        setIsRegistering(false);
        setName('');
        setPassword('');
      } else {
        console.log('[Login] Dispatching login mutation...');
        await login({ email, password });
        console.log('[Login] Login mutation finished.');
      }
    } catch (err: any) {
      console.error('[Login] Submission failed with error:', err);
      setError(err.message || 'Invalid email or password');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 selection:bg-zinc-800 selection:text-white">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900/40 via-zinc-950 to-zinc-950 pointer-events-none" />

      <div className="relative w-full max-w-[400px]">
        {/* Logo / Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-100 shadow-md">
            <KeyRound className="h-5 w-5 text-zinc-400" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
            MT5 AI Journal Analyzer
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Operations & trade investigation portal
          </p>
        </div>

        {/* Card wrapper */}
        <div className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-6 backdrop-blur-md shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-950 bg-red-950/20 p-3.5 text-xs text-red-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="font-medium">{error}</div>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-2.5 rounded-lg border border-emerald-950 bg-emerald-950/20 p-3.5 text-xs text-emerald-400">
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="font-medium">{success}</div>
              </div>
            )}

            {isRegistering && (
              <div className="space-y-1.5 animate-fadeIn">
                <label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Full Name
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                    disabled={isLoading}
                    className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/50 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-650 outline-none ring-offset-zinc-950 transition duration-150 focus:border-zinc-800 focus:ring-2 focus:ring-zinc-800 disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Email Address
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@broker.com"
                  required
                  disabled={isLoading}
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/50 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-605 outline-none ring-offset-zinc-950 transition duration-150 focus:border-zinc-800 focus:ring-2 focus:ring-zinc-800 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                  <KeyRound className="h-4 w-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={isLoading}
                  className="block w-full rounded-lg border border-zinc-900 bg-zinc-950/50 py-2.5 pl-10 pr-10 text-sm text-zinc-100 placeholder-zinc-600 outline-none ring-offset-zinc-950 transition duration-150 focus:border-zinc-800 focus:ring-2 focus:ring-zinc-800 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-600 hover:text-zinc-400 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="relative flex w-full items-center justify-center rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 active:bg-zinc-300 transition duration-150 disabled:opacity-50"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent" />
                  <span>Please wait...</span>
                </div>
              ) : isRegistering ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>

            <div className="text-center pt-2 border-t border-zinc-900/60 mt-3">
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setError(null);
                  setSuccess(null);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition font-medium underline"
              >
                {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
              </button>
            </div>
          </form>
        </div>

        {/* Footer info */}
        <p className="mt-6 text-center text-xs text-zinc-650">
          Secure manager portal. Actions logged for security auditing.
        </p>
      </div>
    </div>
  );
}
