"use client";

/* Contexte « radio courante » pour la console opérateur (En Ondes).
   - Pour owner + it (cross-radio) : charge le parc et mémorise la radio
     administrée. La sélection est posée comme en-tête X-Radio-Id (lu par
     adminTenant côté API) DÈS le 1er rendu (initializer synchrone) → les pages
     requêtent la bonne radio.
   - Pour les non-cross-radio : aucun effet (leur radio vient du JWT). */

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
  // Compteur incrémenté à chaque changement de radio : utilisé comme `key` sur
  // <main> dans le layout pour forcer le remont du sous-arbre admin (et donc le
  // re-fetch de toutes les pages) sans window.location.reload().
  epoch: number;
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
  const [epoch, setEpoch] = useState(0);

  const loadParc = useCallback(() => {
    if (!canSelect) return;
    api
      .get<RadioSummary[]>("/v1/owner/radios")
      .then((rows) => {
        setRadios(rows);
        const cur = localStorage.getItem(KEY);
        // Sélection devenue invalide (radio supprimée) → on nettoie.
        if (cur && !rows.some((r) => r.id === cur)) {
          localStorage.removeItem(KEY);
          setSelectedRadioId(null);
          setSelectedId(null);
          return;
        }
        // 1er login cross-radio avec PLUSIEURS radios et aucune sélection : on
        // auto-sélectionne la 1re (sinon tout l'admin tombe en 404, faute de
        // X-Radio-Id) et on remonte le sous-arbre admin pour que les pages
        // requêtent la bonne radio. En mono-radio, inutile : le backend retombe
        // sur l'unique radio.
        if (!cur && rows.length > 1) {
          localStorage.setItem(KEY, rows[0]!.id);
          setSelectedRadioId(rows[0]!.id);
          setEpoch((e) => e + 1);
        }
      })
      .catch(() => setRadios([]));
  }, [canSelect]);

  useEffect(() => {
    loadParc();
  }, [loadParc]);

  const selectRadio = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setSelectedRadioId(id);
    // Force le remont du sous-arbre admin (clé `epoch` sur <main> dans le
    // layout) → chaque page rejoue son effet de montage → re-fetch sous le
    // nouveau X-Radio-Id. Remplace window.location.reload() : pas de flash plein
    // écran, pas de re-exécution de la reprise de session ; tokens et sélection
    // conservés (les providers Auth/Radio/Toast sont hors du sous-arbre clés).
    // Une invalidation par cache partagé (SWR/React Query) câblé à selectedRadioId
    // serait plus fine mais exigerait une refonte du data-layer = sprint dédié.
    setEpoch((e) => e + 1);
  }, []);

  return (
    <RadioContext.Provider value={{ radios, selectedId, selectRadio, refresh: loadParc, isCrossRadio: canSelect, epoch }}>
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioState {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error("useRadio doit être utilisé dans <RadioProvider>");
  return ctx;
}
