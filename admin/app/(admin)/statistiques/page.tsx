"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, Empty } from "@/components/ui";
import {
  formatDuration,
  type AnalyticsOverview,
  type AnalyticsShow,
  type AnalyticsSession,
} from "@/lib/types";

export default function StatistiquesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin";

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [shows, setShows] = useState<AnalyticsShow[] | null>(null);
  const [sessions, setSessions] = useState<AnalyticsSession[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [ov, sh] = await Promise.all([
        api.get<AnalyticsOverview>("/v1/admin/analytics/overview"),
        api.get<AnalyticsShow[]>("/v1/admin/analytics/shows"),
      ]);
      setOverview(ov);
      setShows(sh);
      if (isAdmin) {
        setSessions(await api.get<AnalyticsSession[]>("/v1/admin/analytics/sessions"));
      }
    } catch {
      setOverview(null);
    }
  }, [isAdmin]);

  // Rafraîchit toutes les 15 s (le compteur « live » bouge vite).
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const maxShow = shows?.[0]?.totalListenSec || 1;

  return (
    <div>
      <div className="page-head">
        <h1>Statistiques d&apos;audience</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          ↻ Rafraîchir
        </button>
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
