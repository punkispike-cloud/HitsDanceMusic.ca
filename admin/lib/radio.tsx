"use client";

/* Contexte « radio courante » pour la console opérateur (owner En Ondes).
   - Pour l'owner : charge le parc et mémorise la radio administrée. La sélection
     est posée comme en-tête X-Radio-Id (lu par adminTenant côté API) DÈS le 1er
     rendu (initializer synchrone) → les pages requêtent la bonne radio.
   - Pour les non-owner : aucun effet (leur radio vient du JWT). */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api, setSelectedRadioId } from "./api";
import { useAuth } from "./auth";
import type { RadioSummary } from "./types";

const KEY = "enondes_radio";

interface RadioState {
  radios: RadioSummary[];
  selectedId: string | null;
  selectRadio: (id: string) => void;
  refresh: () => void;
  isOwner: boolean;
}

const RadioContext = createContext<RadioState | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  // Restaure la sélection AVANT les requêtes des pages (en-tête posé en synchrone).
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(KEY);
    if (v) setSelectedRadioId(v);
    return v;
  });
  const [radios, setRadios] = useState<RadioSummary[]>([]);

  const loadParc = useCallback(() => {
    if (!isOwner) return;
    api
      .get<RadioSummary[]>("/v1/owner/radios")
      .then((rows) => {
        setRadios(rows);
        // Sélection devenue invalide (radio supprimée) → on nettoie.
        setSelectedId((cur) => {
          if (cur && !rows.some((r) => r.id === cur)) {
            localStorage.removeItem(KEY);
            setSelectedRadioId(null);
            return null;
          }
          return cur;
        });
      })
      .catch(() => setRadios([]));
  }, [isOwner]);

  useEffect(() => {
    loadParc();
  }, [loadParc]);

  const selectRadio = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setSelectedRadioId(id);
    // Recharge pour que toutes les pages refetchent les données de la radio.
    window.location.reload();
  }, []);

  return (
    <RadioContext.Provider value={{ radios, selectedId, selectRadio, refresh: loadParc, isOwner }}>
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioState {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio doit être utilisé dans <RadioProvider>");
  return ctx;
}
