"use client";

import { useEffect, useState, useCallback } from "react";
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
} from "@/lib/types";

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

export default function StatistiquesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "superadmin";

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [shows, setShows] = useState<AnalyticsShow[] | null>(null);
  const [sessions, setSessions] = useState<AnalyticsSession[] | null>(null);
  const [series, setSeries] = useState<AnalyticsPoint[] | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const [ov, sh, ts] = await Promise.all([
        api.get<AnalyticsOverview>("/v1/admin/analytics/overview"),
        api.get<AnalyticsShow[]>("/v1/admin/analytics/shows"),
        api.get<AnalyticsPoint[]>(`/v1/admin/analytics/timeseries?days=${days}`),
      ]);
      setOverview(ov);
      setShows(sh);
      setSeries(ts);
      if (isAdmin) {
        setSessions(await api.get<AnalyticsSession[]>("/v1/admin/analytics/sessions"));
      }
    } catch {
      setOverview(null);
    }
  }, [isAdmin, days]);

  // Rafraîchit toutes les 15 s (le compteur « live » bouge vite).
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

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
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
            ↻
          </button>
        </div>
      </div>

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
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.ip ?? "—"}</td>
                        <td>{s.ipCountry ?? "—"}</td>
                        <td>{s.device ?? "—"}</td>
                        <td>{s.browser ?? "—"}</td>
                        <td>{s.pageViews}</td>
                        <td>{formatDuration(s.activeSec)}</td>
                        <td>{formatDuration(s.listenSec)}</td>
                        <td className="muted">
                          {new Date(s.lastSeen).toLocaleString("fr-CA")}
                        </td>
                      </tr>
                    ))}
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
