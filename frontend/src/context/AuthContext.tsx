import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { tokenStorage } from '../lib/api';
import { authApi } from '../lib/auth.api';
import { queryClient } from '../lib/queryClient';
import type { AuthResponse, User } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSession: (auth: AuthResponse) => void;
  /** Re-read the signed-in user, after they change something about themselves. */
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On first load, restore the session from a stored token.
  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setIsLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => tokenStorage.clear())
      .finally(() => setIsLoading(false));
  }, []);

  const setSession = useCallback((auth: AuthResponse) => {
    // Start every session from a clean cache: never let one account see another's cached data
    // (notifications, submissions, …), and force fresh fetches on the landing page instead of
    // showing the previous session's stale rows until they expire.
    queryClient.clear();
    tokenStorage.set(auth.accessToken);
    setUser(auth.user);
  }, []);

  const refreshUser = useCallback(async () => {
    // Failure is silent on purpose: this runs after a change the user already saw succeed, and a
    // hiccup fetching the fresh copy is not worth signing them out over.
    try {
      setUser(await authApi.me());
    } catch {
      /* keep whatever we had */
    }
  }, []);

  const logout = useCallback(() => {
    queryClient.clear();
    tokenStorage.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      setSession,
      refreshUser,
      logout,
    }),
    [user, isLoading, setSession, refreshUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
