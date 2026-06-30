"use client";

/* Hooks de données admin bâtis sur SWR. Chaque hook radio-scopé inclut
   `selectedRadioId` dans sa clé (via `rkey`) → changer de radio change la clé →
   SWR re-fetch la nouvelle radio SANS remont du sous-arbre (l'ancien mécanisme
   `epoch` sur <main> est retiré). `keepPreviousData` sur les LISTES garde les
   données de la radio précédente affichées pendant le fetch de la nouvelle
   (pas de flash « chargement » au switch).

   Le fetcher global (lib/swr.tsx) extrait le 1er élément du tuple (le chemin
   API) et appelle `api.get`, qui pose l'en-tête X-Radio-Id depuis
   `selectedRadioId`. Les hooks non radio-scopés (parc / owner) utilisent une
   clé SANS selectedRadioId (la flotte et le compte opérateur ne dépendent pas
   de la radio administrée). */

import useSWR, { type SWRConfiguration } from "swr";
import { api } from "./api";
import { useRadio } from "./radio";
import { rkey } from "./keys";
import type {
  Artist,
  Show,
  Episode,
  Mix,
  Track,
  AdminUser,
  ScheduleSlot,
  AnalyticsOverview,
  AnalyticsShow,
  AnalyticsSession,
  AnalyticsPoint,
  GeoPoint,
  AnalyticsBreakdown,
  AuditResponse,
  PushStats,
  RadioSummary,
  OwnerOverview,
  RadioHealth,
  OwnerTimeseriesPoint,
  TrackHistoryEntry,
  SongRequest,
  RequestStatus,
  TopTrack,
  Poll,
  PollResults,
  PollStatus,
  DistributionPackage,
  DistributionChannel,
} from "./types";

export { rkey } from "./keys";

const LIST: SWRConfiguration = { keepPreviousData: true };

/* Now-slot du tableau de bord (type local — l'API ne l'expose pas dans types). */
export interface NowSlot {
  from: string;
  to: string;
  title: string;
  host: string;
  tag: string;
  isLive: boolean;
}

/* ─────────────────────── Hooks radio-scopés (listes) ─────────────────────── */

export function useArtists() {
  const { selectedId } = useRadio();
  return useSWR<Artist[]>(rkey("/v1/admin/artists", selectedId), LIST);
}

export function useShows() {
  const { selectedId } = useRadio();
  return useSWR<Show[]>(rkey("/v1/admin/shows", selectedId), LIST);
}

export function useEpisodes() {
  const { selectedId } = useRadio();
  return useSWR<Episode[]>(rkey("/v1/admin/episodes", selectedId), LIST);
}

export function useMixes() {
  const { selectedId } = useRadio();
  return useSWR<Mix[]>(rkey("/v1/admin/mixes", selectedId), LIST);
}

/** Bibliothèque de pistes (source material du studio de mix). Radio-scopée. */
export function useLibrary() {
  const { selectedId } = useRadio();
  return useSWR<Track[]>(rkey("/v1/admin/library", selectedId), LIST);
}

export function useUsers() {
  const { selectedId } = useRadio();
  return useSWR<AdminUser[]>(rkey("/v1/admin/users", selectedId), LIST);
}

export function useSchedule() {
  const { selectedId } = useRadio();
  return useSWR<ScheduleSlot[]>(rkey("/v1/admin/schedule-slots", selectedId), LIST);
}

/* ─────────────────── Hooks radio-scopés (dashboard / now) ────────────────── */

export function useNowSlot() {
  const { selectedId } = useRadio();
  return useSWR<NowSlot | null>(rkey("/v1/schedule/now", selectedId));
}

/** Titres récemment joués — rafraîchis toutes les 20 s (pause auto si onglet
 *  masqué : `refreshWhenHidden` est false par défaut). */
export function useRecentTracks() {
  const { selectedId } = useRadio();
  return useSWR<TrackHistoryEntry[]>(rkey("/v1/admin/tracks/recent?limit=20", selectedId), {
    keepPreviousData: true,
    refreshInterval: 20_000,
  });
}

/** File des demandes / dédicaces — rafraîchie toutes les 5 s (temps-réel animateur).
 *  `status` filtre côté API (encodé dans la clé → re-fetch au changement de filtre).
 *  Hook réutilisable : la future page Studio l'appellera avec `status="new"`. */
export function useRequests(status?: RequestStatus) {
  const { selectedId } = useRadio();
  const path = status
    ? `/v1/admin/requests?status=${status}&limit=200`
    : `/v1/admin/requests?limit=200`;
  return useSWR<SongRequest[]>(rkey(path, selectedId), {
    keepPreviousData: true,
    refreshInterval: 5_000,
  });
}

/** Sondages en direct — rafraîchis toutes les 5 s (résultats temps-réel).
 *  `status` filtre côté API (encodé dans la clé → re-fetch au changement). */
export function usePolls(status?: PollStatus) {
  const { selectedId } = useRadio();
  const path = status ? `/v1/admin/polls?status=${status}&limit=200` : `/v1/admin/polls?limit=200`;
  return useSWR<Poll[]>(rkey(path, selectedId), {
    keepPreviousData: true,
    refreshInterval: 5_000,
  });
}

/** Dépouillement en direct d'un sondage — polling 5 s. `id` null → pas de fetch.
 *  Passer `{ refreshInterval: 0 }` pour un sondage fermé (pas de re-polling). */
export function usePollResults(id: string | null, opts: SWRConfiguration<PollResults> = {}) {
  const { selectedId } = useRadio();
  return useSWR<PollResults>(
    id ? rkey(`/v1/admin/polls/${id}/results`, selectedId) : null,
    { keepPreviousData: true, refreshInterval: 5_000, ...opts },
  );
}

/* ──────────────────── Hooks radio-scopés (statistiques) ────────────────────
   `opts` porte le `refreshInterval` (4 s pour les données « live », 60 s pour
   les « lourdes ») et un éventuel `onSuccess` (ex. horodater la maj). Le
   `keepPreviousData` évite le flash au changement de radio ou de période. */

export function useAnalyticsOverview(opts: SWRConfiguration<AnalyticsOverview> = {}) {
  const { selectedId } = useRadio();
  return useSWR<AnalyticsOverview>(rkey("/v1/admin/analytics/overview", selectedId), { ...LIST, ...opts });
}

export function useAnalyticsGeo(opts: SWRConfiguration<GeoPoint[]> = {}) {
  const { selectedId } = useRadio();
  return useSWR<GeoPoint[]>(rkey("/v1/admin/analytics/geo", selectedId), { ...LIST, ...opts });
}

/** Sessions visiteurs (IP & détails) — réservé aux superadmin/owner. `enabled`
 *  false → clé null → pas de fetch (ni de 403 pour les non-admin). */
export function useAnalyticsSessions(enabled: boolean, opts: SWRConfiguration<AnalyticsSession[]> = {}) {
  const { selectedId } = useRadio();
  return useSWR<AnalyticsSession[]>(
    enabled ? rkey("/v1/admin/analytics/sessions", selectedId) : null,
    { ...LIST, ...opts },
  );
}

export function useAnalyticsShows(opts: SWRConfiguration<AnalyticsShow[]> = {}) {
  const { selectedId } = useRadio();
  return useSWR<AnalyticsShow[]>(rkey("/v1/admin/analytics/shows", selectedId), { ...LIST, ...opts });
}

/** Top titres (feedback de programmation) sur `days` jours — `days` encodé dans
 *  le chemin → re-fetch au changement de période. Polling « lourd » (60 s). */
export function useTopTracks(days: number, opts: SWRConfiguration<TopTrack[]> = {}) {
  const { selectedId } = useRadio();
  return useSWR<TopTrack[]>(
    rkey(`/v1/admin/analytics/top-tracks?days=${days}`, selectedId),
    { ...LIST, ...opts },
  );
}

/** Série quotidienne sur `days` jours — `days` est encodé dans le chemin (query)
 *  donc la clé change quand la période change → re-fetch automatique. */
export function useAnalyticsTimeseries(days: number, opts: SWRConfiguration<AnalyticsPoint[]> = {}) {
  const { selectedId } = useRadio();
  return useSWR<AnalyticsPoint[]>(
    rkey(`/v1/admin/analytics/timeseries?days=${days}`, selectedId),
    { ...LIST, ...opts },
  );
}

export function useAnalyticsBreakdown(opts: SWRConfiguration<AnalyticsBreakdown> = {}) {
  const { selectedId } = useRadio();
  return useSWR<AnalyticsBreakdown>(rkey("/v1/admin/analytics/breakdown", selectedId), { ...LIST, ...opts });
}

/* ──────────────────── Hooks radio-scopés (journal / push) ────────────────── */

/** Journal d'audit filtré par entité/action. Les filtres sont encodés dans le
 *  chemin (query) → la clé change à chaque filtre → re-fetch. */
export function useAudit(entity: string, action: string) {
  const { selectedId } = useRadio();
  const qs = new URLSearchParams();
  if (entity) qs.set("entity", entity);
  if (action) qs.set("action", action);
  qs.set("limit", "150");
  return useSWR<AuditResponse>(rkey(`/v1/admin/audit?${qs.toString()}`, selectedId));
}

/** État Web Push (abonnés, activation) + émissions (pour le ciblage). */
export function usePushStats() {
  const { selectedId } = useRadio();
  return useSWR<PushStats>(rkey("/v1/admin/push/stats", selectedId));
}

/* ──────────── Hooks NON radio-scopés (parc / owner — JWT) ──────────────────
   La console opérateur (owner/it) voit TOUTES ses radios : ces données ne
   dépendent pas de la radio administrée → clé SANS selectedRadioId. `enabled`
   false → clé null → pas de fetch (non-cross-radio → pas de 403). */

export function useOwnerOverview(enabled = true) {
  return useSWR<OwnerOverview>(enabled ? "/v1/owner/overview" : null);
}

export function useOwnerRadios(enabled = true) {
  return useSWR<RadioSummary[]>(enabled ? "/v1/owner/radios" : null);
}

export function useOwnerHealth(enabled = true) {
  return useSWR<RadioHealth[]>(enabled ? "/v1/owner/health" : null);
}

/** Série parc (toutes radios) ou série d'UNE radio (`radioId`). */
export function useOwnerTimeseries(days: number, radioId?: string, enabled = true) {
  const path = radioId
    ? `/v1/owner/timeseries?days=${days}&radio=${radioId}`
    : `/v1/owner/timeseries?days=${days}`;
  return useSWR<OwnerTimeseriesPoint[]>(enabled ? path : null);
}

/* ─────────────────────── Hooks composés (parc) ───────────────────────────── */

export interface TrendPoint {
  day: string;
  value: number;
}

function toTrend(rows: OwnerTimeseriesPoint[] | undefined): TrendPoint[] {
  return (rows ?? []).map((r) => ({ day: r.day, value: r.sessions }));
}

/** Console opérateur : totaux agrégés + liste radios + santé + courbe 30 j.
 *  `reload` revalide les 4 clés (après création/édition/statut d'une radio). */
export function useParc(enabled: boolean) {
  const overview = useOwnerOverview(enabled);
  const radios = useOwnerRadios(enabled);
  const health = useOwnerHealth(enabled);
  const timeseries = useOwnerTimeseries(30, undefined, enabled);
  const healthMap: Record<string, RadioHealth> = health.data
    ? Object.fromEntries(health.data.map((h) => [h.id, h]))
    : {};
  const error = overview.error ?? radios.error ?? null;
  const reload = () =>
    Promise.all([overview.mutate(), radios.mutate(), health.mutate(), timeseries.mutate()]);
  return {
    overview: overview.data,
    radios: radios.data,
    health: healthMap,
    series: toTrend(timeseries.data),
    error,
    reload,
  };
}

/** Page détail d'une radio : la radio (extraite de la liste partagée `parc`),
 *  sa courbe 30 j et sa santé. `radio` vaut `undefined` (chargement), `null`
 *  (introuvable) ou la radio — miroir de la sémantique d'origine. */
export function useRadioDetail(id: string, enabled: boolean) {
  const radios = useOwnerRadios(enabled);
  const timeseries = useOwnerTimeseries(30, id, enabled);
  const health = useOwnerHealth(enabled);
  const radiosArr = radios.data;
  // undefined = chargement, null = radio introuvable, sinon la radio.
  const radio = radiosArr ? (radiosArr.find((r) => r.id === id) ?? null) : undefined;
  const error = radios.error ?? null;
  const reload = () => Promise.all([radios.mutate(), timeseries.mutate(), health.mutate()]);
  return {
    radio,
    series: toTrend(timeseries.data),
    health: health.data?.find((h) => h.id === id) ?? null,
    error,
    reload,
  };
}

/* ─────────────────────── Distribution (parc/[id]) ────────────────────────── */

/** Outil d'inscription d'une radio sur les plateformes externes (TuneIn, Radio
 *  Garden, Alexa, podcasts). Hook NON radio-scopé : la clé pointe vers la
 *  console owner (`/v1/owner/radios/:id/distribution`), qui porte déjà l'id.
 *  `save` persiste l'état coché via PATCH (jsonb merge) et revalide la clé. */
export function useDistribution(id: string | null | undefined) {
  const key = id ? `/v1/owner/radios/${id}/distribution` : null;
  const { data, error, mutate, isValidating } = useSWR<DistributionPackage>(key);
  const save = async (checklist: Record<string, boolean>): Promise<DistributionChannel[]> => {
    const res = await api.patch(`/v1/owner/radios/${id}/distribution`, { checklist });
    const updated = (res as { checklist?: DistributionChannel[] }).checklist ?? [];
    if (data) await mutate({ ...data, checklist: updated }, false);
    else await mutate();
    return updated;
  };
  return { data, error, save, mutate, isValidating };
}
