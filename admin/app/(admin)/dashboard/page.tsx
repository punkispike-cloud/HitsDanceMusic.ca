"use client";

import { useAuth } from "@/lib/auth";
import {
  useArtists,
  useShows,
  useEpisodes,
  useMixes,
  useNowSlot,
  useRecentTracks,
} from "@/lib/hooks";
import { Spinner, ErrorState } from "@/components/ui";

export default function DashboardPage() {
  const { user } = useAuth();
  // Compteurs partagés via le cache SWR (clés radio-scopées) : les compteurs du
  // dashboard réutilisent les listes cachées par les pages CRUD. keepPreviousData
  // garde les valeurs de la radio précédente pendant le fetch de la nouvelle.
  const artists = useArtists();
  const shows = useShows();
  const episodes = useEpisodes();
  const mixes = useMixes();
  const nowSlot = useNowSlot();
  // Titres récemment joués — rafraîchis toutes les 20 s (pause auto onglet masqué).
  const { data: tracks } = useRecentTracks();
  const now = nowSlot.data;

  const stats =
    artists.data && shows.data && episodes.data && mixes.data
      ? {
          artists: artists.data.length,
          shows: shows.data.length,
          episodes: episodes.data.length,
          mixes: mixes.data.length,
        }
      : null;
  // En cas d'échec d'un des indicateurs on NE fabrique PAS de 0 (qui ferait
  // passer une panne pour un parc vide) → on bascule en état erreur.
  const indicatorError =
    artists.error || shows.error || episodes.error || mixes.error || nowSlot.error;
  const error = indicatorError ? "Impossible de charger les indicateurs." : null;
  const reload = () =>
    Promise.all([
      artists.mutate(),
      shows.mutate(),
      episodes.mutate(),
      mixes.mutate(),
      nowSlot.mutate(),
    ]);

  return (
    <div>
      <div className="page-head">
        <h1>Bonjour, {user?.displayName} <span aria-hidden="true">👋</span></h1>
      </div>

      {stats && stats.artists + stats.shows + stats.episodes + stats.mixes === 0 && (
        <div className="card" style={{ marginBottom: 20, borderLeft: "4px solid var(--accent)" }}>
          <h2 style={{ marginTop: 0 }}>Bienvenue — configurons ta radio</h2>
          <p className="muted">Trois étapes pour partir en ondes :</p>
          <ol className="onboarding-steps">
            <li>
              <a href="/animateurs" style={{ color: "var(--accent-2)" }}>Ajoute tes animateurs</a> — l&apos;équipe à l&apos;antenne.
            </li>
            <li>
              <a href="/emissions" style={{ color: "var(--accent-2)" }}>Crée tes émissions</a> — les rendez-vous de la grille.
            </li>
            <li>
              <a href="/grille" style={{ color: "var(--accent-2)" }}>Monte la grille horaire</a> — qui passe, et quand.
            </li>
          </ol>
        </div>
      )}

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
          <h2 style={{ marginTop: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            Titres récemment joués
          </h2>
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

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : !stats ? (
        <Spinner label="Chargement des indicateurs…" />
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
