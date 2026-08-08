import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'DEALER' | 'SUPPORT' | 'RISK';
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem('access_token'),
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(
    localStorage.getItem('refresh_token'),
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch active user profile if access token exists
  const {
    data: userProfile,
    isLoading: isFetchingUser,
    error: fetchUserError,
  } = useQuery({
    queryKey: ['auth-me', accessToken],
    queryFn: async () => {
      console.log('[AuthContext] auth-me fetch started with accessToken:', accessToken?.substring(0, 10) + '...');
      if (!accessToken) return null;
      const res = await fetch('/api/v1/auth/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) {
        console.error('[AuthContext] auth-me fetch failed status:', res.status);
        if (res.status === 401) {
          throw new Error('Unauthorized session');
        }
        throw new Error('Failed to load profile');
      }

      const body = await res.json();
      console.log('[AuthContext] auth-me fetch success. User details:', body.data);
      return body.data as User;
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
  });

  // Automatically handle expired tokens and try to refresh
  useEffect(() => {
    if (fetchUserError) {
      handleRefresh();
    }
  }, [fetchUserError]);

  const handleRefresh = async () => {
    if (!refreshToken) {
      clearSession();
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        throw new Error('Refresh expired');
      }

      const body = await res.json();
      const newAccessToken = body.data.accessToken;

      localStorage.setItem('access_token', newAccessToken);
      setAccessToken(newAccessToken);
    } catch {
      clearSession();
    }
  };

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      console.log('[AuthContext] loginMutation fetch starting for:', credentials.email);
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const body = await res.json();
      if (!res.ok) {
        console.error('[AuthContext] loginMutation API error response:', body);
        throw new Error(body.message || 'Login failed');
      }

      console.log('[AuthContext] loginMutation API response success:', body);
      return body.data as {
        accessToken: string;
        refreshToken: string;
        user: User;
      };
    },
    onSuccess: (data) => {
      console.log('[AuthContext] loginMutation onSuccess. User payload:', data.user);
      localStorage.setItem('access_token', data.accessToken);
      localStorage.setItem('refresh_token', data.refreshToken);
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      queryClient.setQueryData(['auth-me', data.accessToken], data.user);
      
      const origin = (location.state as any)?.from?.pathname || '/dashboard';
      console.log('[AuthContext] loginMutation navigating to:', origin);
      navigate(origin, { replace: true });
    },
  });

  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  const clearSession = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setAccessToken(null);
    setRefreshToken(null);
    queryClient.setQueryData(['auth-me', null], null);
    queryClient.clear();
  };

  const login = async (credentials: { email: string; password: string }) => {
    await loginMutation.mutateAsync(credentials);
  };

  const value = {
    user: userProfile || null,
    accessToken,
    isAuthenticated: !!userProfile,
    isLoading: isFetchingUser || loginMutation.isPending || (!!accessToken && !userProfile),
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200"></div>
          <span className="text-sm font-medium tracking-wide">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
