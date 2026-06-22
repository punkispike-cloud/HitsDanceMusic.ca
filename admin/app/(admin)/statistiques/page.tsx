"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Spinner, Empty } from "@/components/ui";
import {
  formatDuration,
  type AnalyticsOverview,
  type AnalyticsShow,
  type AnalyticsSession,
  type AnalyticsPoint,
  type GeoPoint,
  type AnalyticsBreakdown,
} from "@/lib/types";
import VisitorMap from "./VisitorMap";

/* Mini graphe à barres (SVG, sans dépendance) du temps d'écoute par jour. */
function TimeSeriesChart({ data }: { data: AnalyticsPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.listen_sec));
  const W = 720;
  const H = 140;
  const gap = 2;
  const bw = data.length ? (W - gap * (data.length - 1)) / data.length : W;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" height={H + 22} role="img"
        aria-label="Temps d'écoute par jour">
        {data.map((d, i) => {
          const h = Math.round((d.listen_sec / max) * H);
          const x = i * (bw + gap);
          return (
            <g key={d.day}>
              <rect x={x} y={H - h} width={bw} height={h} rx={2} fill="var(--accent)">
                <title>{`${d.day} — ${formatDuration(d.listen_sec)} écoute · ${d.sessions} visiteur(s)`}</title>
              </rect>
              {i % Math.ceil(data.length / 10 || 1) === 0 && (
                <text x={x + bw / 2} y={H + 14} fontSize="9" fill="var(--muted)" textAnchor="middle">
                  {d.day.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* Liste à barres : libellé · barre proportionnelle · valeur. */
function BarList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <Empty label="Pas encore de données." />;
  return (
    <div className="card">
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ width: 140, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.label}
          </span>
          <span style={{ flex: 1, height: 8, background: "rgba(127,127,127,0.18)", borderRadius: 4 }}>
            <span style={{ display: "block", width: `${(it.value / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4, minWidth: 3 }} />
          </span>
          <span className="muted" style={{ fontSize: "0.8rem", width: 36, textAlign: "right" }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/* Histogramme de l'activité par heure (0-23, fuseau America/Toronto). */
function HourlyChart({ data }: { data: { hour: number; sessions: number }[] }) {
  const byHour = new Array(24).fill(0) as number[];
  for (const d of data) if (d.hour >= 0 && d.hour < 24) byHour[d.hour] = d.sessions;
  const max = Math.max(1, ...byHour);
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90 }}>
        {byHour.map((v, h) => (
          <div key={h} title={`${h} h — ${v} visite(s)`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <div style={{ height: `${(v / max) * 100}%`, background: "var(--accent)", borderRadius: 2, minHeight: v ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>
        <span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span>
      </div>
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
  const isAdmin = user?.role === "superadmin";

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [shows, setShows] = useState<AnalyticsShow[] | null>(null);
  const [sessions, setSessions] = useState<AnalyticsSession[] | null>(null);
  const [series, setSeries] = useState<AnalyticsPoint[] | null>(null);
  const [geo, setGeo] = useState<GeoPoint[] | null>(null);
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdown | null>(null);
  const [days, setDays] = useState(30);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [alertThreshold, setAlertThreshold] = useState(0);
  const [notifOn, setNotifOn] = useState(false);
  const prevLiveRef = useRef(0);
  const seenCountriesRef = useRef<Set<string> | null>(null);

  // Données qui bougent vite : compteur « en direct » + sessions visiteurs.
  const loadLive = useCallback(async () => {
    try {
      const [ov, g] = await Promise.all([
        api.get<AnalyticsOverview>("/v1/admin/analytics/overview"),
        api.get<GeoPoint[]>("/v1/admin/analytics/geo"),
      ]);
      setOverview(ov);
      setGeo(g);
      if (isAdmin) {
        setSessions(await api.get<AnalyticsSession[]>("/v1/admin/analytics/sessions"));
      }
      setUpdatedAt(Date.now());
    } catch {
      /* on garde l'affichage précédent — pas de page blanche sur un hoquet réseau */
    }
  }, [isAdmin]);

  // Données qui bougent lentement : graphe par jour + répartition par émission.
  const loadHeavy = useCallback(async () => {
    try {
      const [sh, ts, bd] = await Promise.all([
        api.get<AnalyticsShow[]>("/v1/admin/analytics/shows"),
        api.get<AnalyticsPoint[]>(`/v1/admin/analytics/timeseries?days=${days}`),
        api.get<AnalyticsBreakdown>("/v1/admin/analytics/breakdown"),
      ]);
      setShows(sh);
      setSeries(ts);
      setBreakdown(bd);
    } catch {
      /* idem : best-effort */
    }
  }, [days]);

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

  const refreshAll = useCallback(() => {
    void loadLive();
    void loadHeavy();
  }, [loadLive, loadHeavy]);

  // Chargement initial + recharge « lourde » quand la période change.
  useEffect(() => {
    void loadHeavy();
  }, [loadHeavy]);
  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  // Boucle « live » (~4 s) — en pause si auto désactivé ou onglet masqué.
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadLive();
    }, LIVE_MS);
    return () => clearInterval(id);
  }, [auto, loadLive]);

  // Boucle « lourde » (60 s).
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadHeavy();
    }, HEAVY_MS);
    return () => clearInterval(id);
  }, [auto, loadHeavy]);

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
              ⬇ CSV émissions
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => void exportCsv("sessions")}>
              ⬇ CSV sessions
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
            {auto ? "⏸ Pause" : "▶ Reprendre le direct"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={refreshAll} title="Rafraîchir maintenant">
            ↻
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

      {!overview ? (
        <Spinner />
      ) : (
        <>
          <div className="cards-grid">
            <div className="card stat-card" style={{ borderLeft: "4px solid var(--ok)" }}>
              <div className="label">● En direct (60 s)</div>
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
          <VisitorMap points={geo} now={nowTick} />

          <h2 style={{ marginTop: 28 }}>Détails de l&apos;audience</h2>
          <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <strong>🔔 Alertes</strong>
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
              <span style={{ color: "var(--ok)", fontSize: "0.8rem" }}>✓ Notifications actives</span>
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
                  <BarList items={breakdown.devices.map((d) => ({ label: d.device, value: d.sessions }))} />
                </div>
                <div>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Navigateurs</h3>
                  <BarList items={breakdown.browsers.map((b) => ({ label: b.browser, value: b.sessions }))} />
                </div>
                <div>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Top villes</h3>
                  <BarList items={breakdown.topCities.map((ci) => ({ label: ci.label, value: ci.sessions }))} />
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
                    <th>Émission</th>
                    <th>Écoute totale</th>
                    <th>Auditeurs</th>
                    <th>Moy. / auditeur</th>
                    <th style={{ width: "30%" }}>Part</th>
                  </tr>
                </thead>
                <tbody>
                  {shows.map((s) => (
                    <tr key={s.showTitle}>
                      <td>{s.showTitle}</td>
                      <td>{formatDuration(s.totalListenSec)}</td>
                      <td>{s.listeners}</td>
                      <td>{formatDuration(s.avgListenSec)}</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            height: 8,
                            borderRadius: 4,
                            background: "var(--accent)",
                            width: `${Math.round((s.totalListenSec / maxShow) * 100)}%`,
                            minWidth: 4,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
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
                ⚖️ Les adresses IP sont des données personnelles (Loi 25). Pense à l&apos;indiquer
                dans ta politique de confidentialité et à définir une durée de conservation.
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Localisation</th>
                      <th>Appareil</th>
                      <th>Navigateur</th>
                      <th>Pages</th>
                      <th>Sur le site</th>
                      <th>Écoute</th>
                      <th>Dernière activité</th>
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
