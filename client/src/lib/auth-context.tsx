import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { clearSession, loadSession, saveSession } from './auth';
import { api, ApiError } from './api';
import type { AuthResponse, CurrentUser, Role } from '../types';

/**
 * Auth state for the SPA (ADR-024).
 *
 * The provider owns ONE source of truth for "who is signed in". It is pure UX:
 * every role check here can be bypassed by editing the browser, and the backend
 * remains the only authority (it re-reads the role from the database on every
 * request — ADR-015). The role is used purely to choose which UI to show, and
 * to avoid sending a customer booking request that is guaranteed to 403.
 */

interface AuthContextValue {
  user: CurrentUser | null;
  /** True until the stored session has been read on first paint. */
  initialising: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: Extract<Role, 'CUSTOMER' | 'PROVIDER'>;
  /**
   * Provider business details. Required when `role` is PROVIDER and rejected
   * otherwise by the server's `registerSchema.superRefine`, so the UI must not
   * send an empty object for a customer.
   *
   * Every field except businessName/city is optional: the provider can complete
   * the rest from their dashboard with PATCH /api/providers/me.
   */
  provider?: {
    businessName: string;
    city: string;
    description?: string;
    phone?: string;
    serviceAreas?: string[];
    yearsExperience?: number;
    /** Rupees, as a plain number. The ₹ symbol is display-only. */
    hourlyRate?: number;
  };
}

/**
 * Where each role lands after signing in or registering (Phase 18).
 *
 * This is UX routing only — it reads the role the SERVER returned in the auth
 * response, never a role the user picked in a form. A hand-edited request body
 * can reach any page, and the server re-checks the role on every request
 * regardless (ADR-015), so this table exists to avoid showing somebody a screen
 * that could only fail.
 */
export function homeForRole(role: Role | null | undefined): string {
  switch (role) {
    case 'ADMIN':
      return '/admin/dashboard';
    case 'PROVIDER':
      return '/provider/dashboard';
    case 'CUSTOMER':
      return '/dashboard';
    default:
      return '/';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Read the persisted session once, synchronously, on mount. `null` until then
  // would flash the signed-out UI at an already-signed-in user.
  const [session, setSession] = useState(() => loadSession());
  const [initialising] = useState(false);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<AuthResponse>('/auth/login', { email, password });
    saveSession(result);
    setSession({ token: result.token, user: result.user });
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const result = await api.post<AuthResponse>('/auth/register', input);
    saveSession(result);
    setSession({ token: result.token, user: result.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Ask the server to revoke the session first; if that fails the local
      // token is still discarded, because the user asked to sign out.
      await api.post('/auth/logout', {});
    } catch {
      // Ignored on purpose — never block sign-out on the network.
    } finally {
      clearSession();
      setSession(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      initialising,
      signIn,
      signUp,
      signOut,
    }),
    [session, initialising, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Re-exported so components can catch an `ApiError` without a second import. */
export { ApiError };
