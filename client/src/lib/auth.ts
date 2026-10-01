import type { AuthResponse, CurrentUser } from '../types';

/**
 * Access-token storage (ADR-024).
 *
 * WHY sessionStorage, NOT localStorage
 *   The backend issues a revocable bearer token over HTTP (no cookie transport),
 *   so the browser has to hold it somewhere. `sessionStorage` is scoped to the
 *   tab and is dropped when the tab closes, so a token stolen via XSS stops
 *   working as soon as the tab is closed. `localStorage` would persist the
 *   token across browser restarts indefinitely, which is a strictly larger
 *   blast radius for no benefit in this app.
 *
 *   This is defence-in-depth for token theft, NOT an auth boundary: the server
 *   re-reads the role from the database on every request (ADR-015), and every
 *   session is revocable server-side. Tampering with this store only produces a
 *   confusing 401, never access.
 *
 * Nothing here stores a password — passwords are sent once, hashed by the
 * server with scrypt, and never returned.
 */

const TOKEN_KEY = 'serviceconnect.token';
const USER_KEY = 'serviceconnect.user';

/** SSR / non-browser safe: returns null when storage is unavailable. */
function readSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Blocked by privacy settings — degrade to in-memory only.
    return null;
  }
}

/** Fallback for browsers (and the SSR test harness) without sessionStorage. */
let memoryToken: string | null = null;
let memoryUser: string | null = null;

export interface StoredSession {
  token: string;
  user: CurrentUser;
}

export function loadSession(): StoredSession | null {
  const store = readSessionStorage();
  const token = store ? store.getItem(TOKEN_KEY) : memoryToken;
  const rawUser = store ? store.getItem(USER_KEY) : memoryUser;
  if (!token || !rawUser) return null;

  try {
    return { token, user: JSON.parse(rawUser) as CurrentUser };
  } catch {
    // Corrupt entry — drop it rather than crash the whole app.
    clearSession();
    return null;
  }
}

export function saveSession(response: AuthResponse): void {
  const user = JSON.stringify(response.user);
  const store = readSessionStorage();
  if (store) {
    store.setItem(TOKEN_KEY, response.token);
    store.setItem(USER_KEY, user);
  } else {
    memoryToken = response.token;
    memoryUser = user;
  }
}

export function clearSession(): void {
  const store = readSessionStorage();
  if (store) {
    store.removeItem(TOKEN_KEY);
    store.removeItem(USER_KEY);
  }
  memoryToken = null;
  memoryUser = null;
}

/** Current bearer token, or null. Read per request so it is never stale. */
export function getAccessToken(): string | null {
  return loadSession()?.token ?? null;
}
