"use client";

/* Provider SWR racine : pose un fetcher global qui extrait le chemin API de la
   clé (la clé est un tuple `[path, selectedRadioId, ...]` ou une simple chaîne)
   et délègue à `api.get` (qui attache le Bearer + l'en-tête X-Radio-Id posé par
   setSelectedRadioId). Pas de revalidation au focus (l'admin ne doit pas
   spammer l'API au retour d'onglet) ; deduplication 2 s pour éviter les
   requêtes en rafale. */

import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { api } from "./api";

function pathOf(key: unknown): string {
  if (Array.isArray(key)) return String(key[0]);
  return String(key);
}

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: unknown) => api.get(pathOf(key)),
        revalidateOnFocus: false,
        dedupingInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
