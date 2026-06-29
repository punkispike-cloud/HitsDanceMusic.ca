"use client";

/* Contexte « radio courante » pour la console opérateur (En Ondes).
   - Pour owner + it (cross-radio) : charge le parc et mémorise la radio
     administrée. La sélection est posée comme en-tête X-Radio-Id (lu par
     adminTenant côté API) DÈS le 1er rendu (initializer synchrone) → les pages
     requêtent la bonne radio.
   - Pour les non-cross-radio : aucun effet (leur radio vient du JWT).

   NOUVEAU modèle data-layer (refonte SWR) : les hooks de données incluent
   `selectedId` dans leur clé SWR → changer de radio change la clé → SWR
   re-fetch automatiquement la nouvelle radio, SANS remont du sous-arbre admin
   (l'ancien compteur `epoch` / `key={epoch}` sur <main> est retiré). L'état UI
   éphémère (modals ouverts, scroll, brouillons) est donc préservé au switch.
   L'auto-select (1er login multi-radio) et la cleanup (sélection invalide)
   pilotent `selectedId` : null → 1re radio fait changer les clés → re-fetch. */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api, setSelectedRadioId } from "./api";
import { useAuth } from "./auth";
import { isCrossRadio, type RadioSummary } from "./types";

const KEY = "enondes_radio";

interface RadioState {
  radios: RadioSummary[];
  selectedId: string | null;
  selectRadio: (id: string) => void;
  refresh: () => void;
  isCrossRadio: boolean;
}

const RadioContext = createContext<RadioState | null>(null);

export function RadioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const canSelect = isCrossRadio(user?.role);

  // Restaure la sélection AVANT les requêtes des pages (en-tête posé en synchrone).
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(KEY);
    if (v) setSelectedRadioId(v);
    return v;
  });
  const [radios, setRadios] = useState<RadioSummary[]>([]);

  const loadParc = useCallback(() => {
    if (!canSelect) return;
    api
      .get<RadioSummary[]>("/v1/owner/radios")
      .then((rows) => {
        setRadios(rows);
        let cur = localStorage.getItem(KEY);
        // Sélection devenue invalide (radio supprimée) → on nettoie.
        if (cur && !rows.some((r) => r.id === cur)) {
          localStorage.removeItem(KEY);
          setSelectedRadioId(null);
          setSelectedId(null);
          cur = null;
        }
        // 1er login cross-radio avec PLUSIEURS radios et aucune sélection (ou
        // juste après une cleanup) : on auto-sélectionne la 1re (sinon tout
        // l'admin tombe en 404, faute de X-Radio-Id). Sans `epoch`, c'est le
        // passage selectedId null → 1re radio qui fait changer les clés SWR →
        // les pages re-fetch sous le bon X-Radio-Id. En mono-radio, inutile :
        // le backend retombe sur l'unique radio.
        if (!cur && rows.length > 1) {
          const first = rows[0]!.id;
          localStorage.setItem(KEY, first);
          setSelectedRadioId(first);
          setSelectedId(first);
        }
      })
      .catch(() => setRadios([]));
  }, [canSelect]);

  useEffect(() => {
    loadParc();
  }, [loadParc]);

  const selectRadio = useCallback((id: string) => {
    // setSelectedRadioId AVANT setSelectedId : l'en-tête X-Radio-Id doit être
    // posé quand React re-render avec la nouvelle clé SWR (le fetcher lira la
    // bonne radio). Les deux updates sont batchés → un seul rendu sous la
    // nouvelle radio.
    localStorage.setItem(KEY, id);
    setSelectedRadioId(id);
    setSelectedId(id);
  }, []);

  return (
    <RadioContext.Provider value={{ radios, selectedId, selectRadio, refresh: loadParc, isCrossRadio: canSelect }}>
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioState {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio doit être utilisé dans <RadioProvider>");
  return ctx;
}
