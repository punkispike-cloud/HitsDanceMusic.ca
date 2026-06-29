"use client";

/* Contexte d'authentification. L'access token reste EN MÉMOIRE (jamais
   localStorage). Au chargement, on tente un /auth/refresh silencieux : si un
   cookie refresh valide existe, la session reprend sans re-login. */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api, setAccessToken, setSelectedRadioId, setOnUnauthorized, API_BASE } from "./api";
import type { AuthUser } from "./types";

/* Cookie marqueur de session pour la garde anti-flash du middleware (admin/
   middleware.ts). NON sensible : valeur "1", posé sur l'origine admin (path /).

   Pourquoi un marqueur séparé plutôt que le cookie httpOnly `hr_refresh` ?
   - `hr_refresh` est posé par l'API avec `path: "/auth"` et, en prod, l'admin et
     l'API sont sur des domaines distincts (cross-site). Le navigateur ne l'envoie
     donc JAMAIS vers l'origine admin ni vers une route non-/auth → un middleware
     Next sur l'admin ne pourrait pas le lire sur /parc, /dashboard, etc.
   - Ce marqueur présence-only est lisible côté serveur (admin/middleware.ts) et
     évite le flash de contenu sur un accès direct URL (ex. /parc).

   Garde NON sécuritaire : l'API reste la source de vérité. Un marqueur isolé
   sans session réelle → la reprise silencieuse /auth/refresh échoue → l'admin
   bascule en redirect client vers /login (et efface le marqueur). max-age aligné
   sur REFRESH_TOKEN_TTL (30 j côté API). */
const SESSION_COOKIE = "hr_session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 j

function writeSessionMarker(present: boolean) {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  const rest = present ? `max-age=${SESSION_MAX_AGE}` : "max-age=0";
  document.cookie = `${SESSION_COOKIE}=${present ? "1" : ""}; path=/; samesite=lax; ${rest}${secure}`;
}

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
            writeSessionMarker(true);
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
      writeSessionMarker(false);
    });
    return () => setOnUnauthorized(null);
  }, []);

  // Repart d'un contexte radio propre (évite d'hériter de la sélection d'un
  // autre compte sur un poste partagé).
  const resetRadio = () => {
    setSelectedRadioId(null);
    try {
      localStorage.removeItem("enondes_radio");
    } catch {
      /* SSR / pas de localStorage */
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ accessToken: string; user: AuthUser }>("/auth/login", {
      email,
      password,
    });
    resetRadio();
    setAccessToken(data.accessToken);
    setUser(data.user);
    writeSessionMarker(true);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    resetRadio();
    setAccessToken(null);
    setUser(null);
    writeSessionMarker(false);
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
