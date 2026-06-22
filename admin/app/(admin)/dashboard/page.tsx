"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import type { Artist, Show, Episode, Mix, TrackHistoryEntry } from "@/lib/types";

interface NowSlot {
  from: string;
  to: string;
  title: string;
  host: string;
  tag: string;
  isLive: boolean;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<{
    artists: number;
    shows: number;
    episodes: number;
    mixes: number;
  } | null>(null);
  const [now, setNow] = useState<NowSlot | null>(null);
  const [tracks, setTracks] = useState<TrackHistoryEntry[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [artists, shows, episodes, mixes, nowSlot] = await Promise.all([
          api.get<Artist[]>("/v1/admin/artists"),
          api.get<Show[]>("/v1/admin/shows"),
          api.get<Episode[]>("/v1/admin/episodes"),
          api.get<Mix[]>("/v1/admin/mixes"),
          api.get<NowSlot | null>("/v1/schedule/now"),
        ]);
        setStats({
          artists: artists.length,
          shows: shows.length,
          episodes: episodes.length,
          mixes: mixes.length,
        });
        setNow(nowSlot);
      } catch {
        setStats({ artists: 0, shows: 0, episodes: 0, mixes: 0 });
      }
    })();
  }, []);

  // Titres récemment joués — rafraîchis toutes les 20 s.
  useEffect(() => {
    const load = () =>
      api
        .get<TrackHistoryEntry[]>("/v1/admin/tracks/recent?limit=20")
        .then(setTracks)
        .catch(() => {});
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Bonjour, {user?.displayName} 👋</h1>
      </div>

      {now && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--accent)" }}>
          <div className="muted" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {now.isLive ? "● En direct maintenant" : "À l'antenne"}
          </div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: 4 }}>{now.title}</div>
          <div className="muted">
            {now.from}–{now.to} · {now.host}
          </div>
        </div>
      )}

      {tracks && tracks.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>🎵 Titres récemment joués</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Titre</th>
                  <th>Artiste</th>
                  <th>Passé à</th>
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td className="muted">{t.artist || "—"}</td>
                    <td className="muted">{new Date(t.playedAt).toLocaleTimeString("fr-CA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!stats ? (
        <Spinner />
      ) : (
        <div className="cards-grid">
          <div className="card stat-card">
            <div className="label">Animateurs</div>
            <div className="value">{stats.artists}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Émissions</div>
            <div className="value">{stats.shows}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Podcasts</div>
            <div className="value">{stats.episodes}</div>
          </div>
          <div className="card stat-card">
            <div className="label">Mixes</div>
            <div className="value">{stats.mixes}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 22 }}>
        <h2>Raccourcis</h2>
        <p className="muted">
          Gère la <a href="/grille" style={{ color: "var(--accent-2)" }}>grille horaire</a>, les{" "}
          <a href="/animateurs" style={{ color: "var(--accent-2)" }}>animateurs</a> et les{" "}
          <a href="/emissions" style={{ color: "var(--accent-2)" }}>émissions</a> depuis le menu de gauche.
        </p>
      </div>
    </div>
  );
}
