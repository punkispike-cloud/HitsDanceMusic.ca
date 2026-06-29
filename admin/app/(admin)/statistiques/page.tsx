"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  useAnalyticsOverview,
  useAnalyticsGeo,
  useAnalyticsSessions,
  useAnalyticsShows,
  useAnalyticsTimeseries,
  useAnalyticsBreakdown,
} from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Empty, ErrorState, TableSkeleton } from "@/components/ui";
import { formatDuration, isEditorialAdmin, type AnalyticsPoint } from "@/lib/types";
import VisitorMap from "./VisitorMap";

/* Icônes inline (24x24, currentColor, stroke ~1.75) — accompagnent un libellé
   texte ou un aria-label sur le bouton parent ; décoratives ici. */
const svgBase = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};
function IconDownload() {
  return (
    <svg {...svgBase}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function IconRefresh() {
  return (
    <svg {...svgBase}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg {...svgBase}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg {...svgBase}>
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg {...svgBase}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg {...svgBase} width={16} height={16}>
      <path d="m20 6-11 11L4 12" />
    </svg>
  );
}

/* Mini graphe à barres (SVG, sans dépendance) du temps d'écoute par jour. */
function TimeSeriesChart({ data }: { data: AnalyticsPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.listen_sec));
  const peak = data.reduce<AnalyticsPoint | null>((a, d) => (!a || d.listen_sec > a.listen_sec ? d : a), null);
  const W = 720;
  const H = 140;
  const gap = 2;
  const bw = data.length ? (W - gap * (data.length - 1)) / data.length : W;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" height={H + 22} role="img"
        aria-label={`Temps d'écoute par jour. Pic : ${peak ? `${formatDuration(peak.listen_sec)} le ${peak.day}` : "—"}.`}>
        {/* Axe horizontal de base, visible (pas porté par la couleur seule). */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="var(--line)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = Math.round((d.listen_sec / max) * H);
          const x = i * (bw + gap);
          const isPeak = d === peak;
          return (
            <g key={d.day}>
              {/* Le pic est souligné par une opacité pleine + une marque, pas seulement par la couleur. */}
              <rect x={x} y={H - h} width={bw} height={h} rx={2} fill="var(--accent)" opacity={isPeak ? 1 : 0.78}>
                <title>{`${d.day} — ${formatDuration(d.listen_sec)} écoute · ${d.sessions} visiteur(s)${isPeak ? " · pic" : ""}`}</title>
              </rect>
              {isPeak && h > 0 && (
                <circle cx={x + bw / 2} cy={H - h - 4} r={2.4} fill="var(--accent)" />
              )}
              {i % Math.ceil(data.length / 10 || 1) === 0 && (
                <text x={x + bw / 2} y={H + 14} fontSize="9" fill="var(--txt-dim)" textAnchor="middle">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Alternative tabulaire réservée aux lecteurs d'écran. */}
      <table className="sr-only">
        <caption>Temps d&apos;écoute par jour</caption>
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Écoute</th>
            <th scope="col">Visiteurs</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{formatDuration(d.listen_sec)}</td>
              <td>{d.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Liste à barres : libellé · barre proportionnelle · valeur.
   `caption` décrit la série pour l'alternative tabulaire lecteurs d'écran. */
function BarList({ items, caption }: { items: { label: string; value: number }[]; caption?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!items.length) return <Empty label="Pas encore de données." />;
  return (
    <div className="card">
      <div aria-hidden="true">
        {items.map((it) => (
          <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ width: 140, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {it.label}
            </span>
            <span style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}>
              <span style={{ display: "block", width: `${(it.value / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4, minWidth: 3 }} />
            </span>
            <span className="muted" style={{ fontSize: "0.8rem", width: 36, textAlign: "right" }}>{it.value}</span>
          </div>
        ))}
      </div>
      {/* Alternative tabulaire réservée aux lecteurs d'écran (avec part en %). */}
      <table className="sr-only">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">Libellé</th>
            <th scope="col">Sessions</th>
            <th scope="col">Part</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.label}>
              <th scope="row">{it.label}</th>
              <td>{it.value}</td>
              <td>{total ? `${Math.round((it.value / total) * 100)} %` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Histogramme de l'activité par heure (0-23, fuseau America/Toronto). */
function HourlyChart({ data }: { data: { hour: number; sessions: number }[] }) {
  const byHour = new Array(24).fill(0) as number[];
  for (const d of data) if (d.hour >= 0 && d.hour < 24) byHour[d.hour] = d.sessions;
  const max = Math.max(1, ...byHour);
  const peakHour = byHour.indexOf(max);
  return (
    <div className="card">
      <div
        role="img"
        aria-label={`Activité par heure (heure de Montréal). Pic à ${peakHour} h avec ${max} visite(s).`}
        style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90, borderBottom: "1px solid var(--line)" }}
      >
        {byHour.map((v, h) => (
          <div key={h} title={`${h} h — ${v} visite(s)`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            {/* Le pic est marqué par une opacité pleine (les autres barres atténuées). */}
            <div style={{ height: `${(v / max) * 100}%`, background: "var(--accent)", opacity: h === peakHour && v > 0 ? 1 : 0.78, borderRadius: 2, minHeight: v ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--txt-dim)", marginTop: 4 }}>
        <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span>
      </div>
      {/* Alternative tabulaire réservée aux lecteurs d'écran. */}
      <table className="sr-only">
        <caption>Activité par heure (heure de Montréal)</caption>
        <thead>
          <tr>
            <th scope="col">Heure</th>
            <th scope="col">Visites</th>
          </tr>
        </thead>
        <tbody>
          {byHour.map((v, h) => (
            <tr key={h}>
              <th scope="row">{h} h</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Étiquette relative compacte, ex. « il y a 3 s ». */
function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 2) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  return `il y a ${Math.floor(s / 60)} min`;
}

const LIVE_MS = 4_000; // rafraîchissement « live » (sessions + compteur en direct)
const HEAVY_MS = 60_000; // rafraîchissement « lourd » (graphe + émissions)
const LIVE_WINDOW_MS = 60_000; // une session vue il y a moins de 60 s = « en direct »

export default function StatistiquesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = isEditorialAdmin(user?.role);

  const [days, setDays] = useState(30);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [alertThreshold, setAlertThreshold] = useState(0);
  const [notifOn, setNotifOn] = useState(false);
  const prevLiveRef = useRef(0);
  const seenCountriesRef = useRef<Set<string> | null>(null);

  // Data-layer SWR : clés radio-scopées (incluant selectedRadioId via rkey) →
  // changer de radio change la clé → re-fetch auto, sans remont du sous-arbre.
  // Le polling est porté par `refreshInterval` (4 s « live », 60 s « lourd ») ;
  // `refreshWhenHidden` false par défaut → pause auto onglet masqué ; interval
  // 0 quand `auto` est coupé. `keepPreviousData` (posé dans les hooks) garde la
  // radio / la période précédente pendant le fetch (pas de flash).
  const liveInterval = auto ? LIVE_MS : 0;
  const heavyInterval = auto ? HEAVY_MS : 0;
  const overviewRes = useAnalyticsOverview({
    refreshInterval: liveInterval,
    onSuccess: () => setUpdatedAt(Date.now()),
  });
  const geoRes = useAnalyticsGeo({ refreshInterval: liveInterval });
  const sessionsRes = useAnalyticsSessions(isAdmin, { refreshInterval: liveInterval });
  const showsRes = useAnalyticsShows({ refreshInterval: heavyInterval });
  const seriesRes = useAnalyticsTimeseries(days, { refreshInterval: heavyInterval });
  const breakdownRes = useAnalyticsBreakdown({ refreshInterval: heavyInterval });
  const overview = overviewRes.data;
  const geo = geoRes.data;
  const sessions = sessionsRes.data;
  const shows = showsRes.data;
  const series = seriesRes.data;
  const breakdown = breakdownRes.data;
  // Erreur : seul le 1er échec (aucune donnée encore) bascule en état erreur —
  // les hoquets réseau ultérieurs gardent l'affichage précédent (best-effort).
  const error = !overview && overviewRes.error ? "Impossible de charger les statistiques." : null;

  // Émet une alerte : toast in-app + notification navigateur (si autorisée).
  const fireAlert = useCallback(
    (title: string, body: string) => {
      toast(`${title} — ${body}`, "warn");
      if (notifOn && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(`📻 ${title}`, { body });
        } catch {
          /* noop */
        }
      }
    },
    [toast, notifOn],
  );

  // Revalide toutes les clés analytics (retry + bouton « Rafraîchir »).
  const refreshAll = useCallback(() => {
    void mutate(
      (key) =>
        Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("/v1/admin/analytics"),
    );
  }, []);

  // Horloge 1 s pour l'étiquette « maj il y a Xs » + recalcul des points « live ».
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Alertes : seuil d'auditeurs en direct franchi + apparition d'un nouveau pays.
  useEffect(() => {
    if (!overview) return;
    const live = overview.live;
    if (alertThreshold > 0 && live >= alertThreshold && prevLiveRef.current < alertThreshold) {
      fireAlert(`${live} auditeurs en direct`, `Seuil de ${alertThreshold} atteint`);
    }
    prevLiveRef.current = live;

    const countries = new Set(
      (geo ?? [])
        .map((p) => (p.label ?? "").split(",").pop()?.trim())
        .filter((s): s is string => !!s),
    );
    if (seenCountriesRef.current === null) {
      seenCountriesRef.current = countries; // 1er chargement : mémoriser sans alerter
    } else {
      for (const c of countries) {
        if (!seenCountriesRef.current.has(c)) {
          seenCountriesRef.current.add(c);
          fireAlert("Nouveau pays", `Un visiteur depuis ${c}`);
        }
      }
    }
  }, [overview, geo, alertThreshold, fireAlert]);

  // Active les notifications navigateur (demande la permission).
  const enableNotifs = async () => {
    if (typeof Notification === "undefined") {
      toast("Notifications non supportées par ce navigateur", "warn");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      setNotifOn(true);
      toast("Notifications activées", "ok");
    } else {
      toast("Notifications refusées", "warn");
    }
  };

  const exportCsv = async (type: "sessions" | "shows") => {
    try {
      await api.download(`/v1/admin/analytics/export?type=${type}`, `${type}.csv`);
    } catch {
      toast("Export impossible", "error");
    }
  };

  const maxShow = shows?.[0]?.totalListenSec || 1;
  const totalShowSec = (shows ?? []).reduce((a, s) => a + s.totalListenSec, 0);

  return (
    <div>
      <div className="page-head">
        <h1>Statistiques d&apos;audience</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select aria-label="Période" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 130 }}>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
          </select>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv("shows")}>
              <IconDownload /> CSV émissions
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv("sessions")}>
              <IconDownload /> CSV sessions
            </button>
          )}
          <span
            className="stats-live"
            title={updatedAt ? `Dernière mise à jour : ${new Date(updatedAt).toLocaleTimeString("fr-CA")}` : ""}
          >
            <span className={auto ? "stats-dot stats-dot--on" : "stats-dot"} />
            {auto ? "En direct" : "En pause"}
            {updatedAt && <span className="muted" style={{ marginLeft: 6 }}>· maj {relTime(updatedAt, nowTick)}</span>}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setAuto((a) => !a)}
            title={auto ? "Mettre le direct en pause" : "Reprendre le direct"}
          >
            {auto ? <IconPause /> : <IconPlay />} {auto ? "Pause" : "Reprendre le direct"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={refreshAll}
            title="Rafraîchir maintenant"
            aria-label="Rafraîchir maintenant"
          >
            <IconRefresh />
          </button>
        </div>
      </div>

      <style>{`
        .stats-live { display:inline-flex; align-items:center; gap:6px; font-size:.82rem; font-weight:600; }
        .stats-dot { width:8px; height:8px; border-radius:50%; background:var(--muted); display:inline-block; }
        .stats-dot--on { background:#19c37d; animation:statsPulse 1.4s ease-in-out infinite; }
        .stats-livedot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#19c37d; margin-right:6px; vertical-align:middle; animation:statsPulse 1.4s ease-in-out infinite; }
        .stats-row-live > td:first-child { box-shadow: inset 3px 0 0 #19c37d; }
        @keyframes statsPulse { 0%,100%{ box-shadow:0 0 0 0 rgba(25,195,125,.55);} 50%{ box-shadow:0 0 0 5px rgba(25,195,125,0);} }
      `}</style>

      {!overview && error ? (
        <ErrorState message={error} onRetry={refreshAll} />
      ) : !overview ? (
        <TableSkeleton cols={4} rows={6} />
      ) : (
        <>
          <div className="cards-grid">
            <div className="card stat-card" style={{ borderLeft: "4px solid var(--ok)" }}>
              <div className="label"><span aria-hidden="true">● </span>En direct (60 s)</div>
              <div className="value">{overview.live}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Visiteurs aujourd&apos;hui</div>
              <div className="value">{overview.today}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Visiteurs (total)</div>
              <div className="value">{overview.totalSessions}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Pages vues</div>
              <div className="value">{overview.pageViews}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Temps d&apos;écoute total</div>
              <div className="value">{formatDuration(overview.totalListenSec)}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Temps sur le site (total)</div>
              <div className="value">{formatDuration(overview.totalActiveSec)}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Écoute moy. / visiteur</div>
              <div className="value">{formatDuration(overview.avgListenSec)}</div>
            </div>
            <div className="card stat-card">
              <div className="label">Temps moy. / visiteur</div>
              <div className="value">{formatDuration(overview.avgActiveSec)}</div>
            </div>
          </div>

          <h2 style={{ marginTop: 28 }}>Carte des visiteurs en direct</h2>
          <VisitorMap points={geo ?? null} now={nowTick} />

          <h2 style={{ marginTop: 28 }}>Détails de l&apos;audience</h2>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><IconBell /> Alertes</strong>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
              M&apos;alerter si ≥
              <input
                type="number"
                min={0}
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 64 }}
              />
              en direct
            </label>
            <span className="muted" style={{ fontSize: "0.8rem" }}>+ tout nouveau pays</span>
            {!notifOn ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void enableNotifs()}>
                Activer les notifications navigateur
              </button>
            ) : (
              <span style={{ color: "var(--ok)", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCheck /> Notifications actives
              </span>
            )}
          </div>

          {breakdown && (
            <>
              <div className="cards-grid" style={{ marginTop: 12 }}>
                <div className="card stat-card">
                  <div className="label">Nouveaux visiteurs</div>
                  <div className="value">{breakdown.newVsReturning.fresh}</div>
                </div>
                <div className="card stat-card">
                  <div className="label">Visiteurs de retour</div>
                  <div className="value">{breakdown.newVsReturning.returning}</div>
                </div>
                <div className="card stat-card">
                  <div className="label">Taux de retour</div>
                  <div className="value">
                    {(() => {
                      const t = breakdown.newVsReturning.fresh + breakdown.newVsReturning.returning;
                      return t ? `${Math.round((breakdown.newVsReturning.returning / t) * 100)} %` : "—";
                    })()}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 12 }}>
                <div>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Appareils</h3>
                  <BarList caption="Sessions par appareil" items={breakdown.devices.map((d) => ({ label: d.device, value: d.sessions }))} />
                </div>
                <div>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Navigateurs</h3>
                  <BarList caption="Sessions par navigateur" items={breakdown.browsers.map((b) => ({ label: b.browser, value: b.sessions }))} />
                </div>
                <div>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Top villes</h3>
                  <BarList caption="Sessions par ville" items={breakdown.topCities.map((ci) => ({ label: ci.label, value: ci.sessions }))} />
                </div>
              </div>

              <h3 style={{ fontSize: "0.95rem", margin: "16px 0 8px" }}>Activité par heure (heure de Montréal)</h3>
              <HourlyChart data={breakdown.hourly} />
            </>
          )}

          <h2 style={{ marginTop: 28 }}>Écoute par jour ({days} derniers jours)</h2>
          {series && series.length > 0 ? (
            <TimeSeriesChart data={series} />
          ) : (
            <Empty label="Pas encore de données." />
          )}

          <h2 style={{ marginTop: 28 }}>Temps d&apos;écoute par émission</h2>
          {!shows || shows.length === 0 ? (
            <Empty label="Pas encore de données d'écoute." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Émission</th>
                    <th scope="col">Écoute totale</th>
                    <th scope="col">Auditeurs</th>
                    <th scope="col">Moy. / auditeur</th>
                    <th scope="col" style={{ width: "30%" }}>Part</th>
                  </tr>
                </thead>
                <tbody>
                  {shows.map((s) => {
                    const part = totalShowSec ? Math.round((s.totalListenSec / totalShowSec) * 100) : 0;
                    return (
                    <tr key={s.showTitle}>
                      <th scope="row">{s.showTitle}</th>
                      <td>{formatDuration(s.totalListenSec)}</td>
                      <td>{s.listeners}</td>
                      <td>{formatDuration(s.avgListenSec)}</td>
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span aria-hidden="true" style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}>
                            <span
                              style={{
                                display: "block",
                                height: "100%",
                                borderRadius: 4,
                                background: "var(--accent)",
                                width: `${Math.round((s.totalListenSec / maxShow) * 100)}%`,
                                minWidth: 4,
                              }}
                            />
                          </span>
                          {/* La valeur n'est plus portée par la seule barre : % explicite. */}
                          <span style={{ fontVariantNumeric: "tabular-nums", width: 42, textAlign: "right" }}>{part} %</span>
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2 style={{ marginTop: 28 }}>
            Sessions visiteurs {isAdmin ? "(IP & détails)" : ""}
          </h2>
          {!isAdmin ? (
            <Empty label="Le détail des sessions (IP) est réservé aux super-administrateurs." />
          ) : !sessions || sessions.length === 0 ? (
            <Empty label="Aucune session enregistrée." />
          ) : (
            <>
              <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 10 }}>
                <span aria-hidden="true">⚖️ </span>Les adresses IP sont des données personnelles (Loi 25). Pense à l&apos;indiquer
                dans ta politique de confidentialité et à définir une durée de conservation.
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">IP</th>
                      <th scope="col">Localisation</th>
                      <th scope="col">Appareil</th>
                      <th scope="col">Navigateur</th>
                      <th scope="col">Pages</th>
                      <th scope="col">Sur le site</th>
                      <th scope="col">Écoute</th>
                      <th scope="col">Dernière activité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const isLive = nowTick - new Date(s.lastSeen).getTime() < LIVE_WINDOW_MS;
                      return (
                        <tr key={s.id} className={isLive ? "stats-row-live" : undefined}>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.ip ?? "—"}</td>
                          <td>{s.ipCountry ?? "—"}</td>
                          <td>{s.device ?? "—"}</td>
                          <td>{s.browser ?? "—"}</td>
                          <td>{s.pageViews}</td>
                          <td>{formatDuration(s.activeSec)}</td>
                          <td>{formatDuration(s.listenSec)}</td>
                          <td className="muted">
                            {isLive && <span className="stats-livedot" title="Actif en ce moment" />}
                            {new Date(s.lastSeen).toLocaleString("fr-CA")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
