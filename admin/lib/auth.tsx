"use client";

/* Contexte d'authentification. L'access token reste EN MÉMOIRE (jamais
   localStorage). Au chargement, on tente un /auth/refresh silencieux : si un
   cookie refresh valide existe, la session reprend sans re-login. */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api, setAccessToken, setOnUnauthorized, API_BASE } from "./api";
import type { AuthUser } from "./types";

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Reprise de session silencieuse au montage.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (r.ok) {
          const data = await r.json();
          if (alive && data.accessToken) {
            setAccessToken(data.accessToken);
            setUser(data.user);
          }
        }
      } catch {
        /* pas de session : on reste déconnecté */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Le client API nous prévient si la session est définitivement perdue.
  useEffect(() => {
    setOnUnauthorized(() => {
      setAccessToken(null);
      setUser(null);
    });
    return () => setOnUnauthorized(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ accessToken: string; user: AuthUser }>("/auth/login", {
      email,
      password,
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
