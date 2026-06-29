"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, ErrorState } from "@/components/ui";
import { AudioUpload } from "@/components/audio-upload";
import { isEditorialAdmin } from "@/lib/types";
import type { Artist, Episode } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "archived", label: "Archivé" },
];

const columns: Column<Episode>[] = [
  { key: "title", label: "Titre" },
  {
    key: "audioUrl",
    label: "Audio",
    render: (r) =>
      r.audioUrl ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {/* icône note de musique (décorative, libellé texte porte le sens) */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          prêt
        </span>
      ) : (
        <span className="muted">à téléverser</span>
      ),
  },
  {
    key: "status",
    label: "Statut",
    render: (r) => (
      <span>
        <span className={`status-dot status-${r.status}`} />
        {STATUS_OPTIONS.find((s) => s.value === r.status)?.label}
      </span>
    ),
  },
  {
    key: "publishedAt",
    label: "Publié le",
    render: (r) => (r.publishedAt ? new Date(r.publishedAt).toLocaleDateString("fr-CA") : "—"),
  },
];

export default function PodcastsPage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);
  // On distingue l'erreur du chargement : null + error (jamais setArtists([])).
  const [error, setError] = useState<string | null>(null);

  const loadArtists = () => {
    setError(null);
    setArtists(null);
    api
      .get<Artist[]>("/v1/admin/artists")
      .then(setArtists)
      .catch((e) => setError((e as ApiError).message || "Échec du chargement des animateurs."));
  };
  useEffect(loadArtists, []);

  if (error) return <ErrorState message={error} onRetry={loadArtists} />;
  if (!artists) return <Spinner />;
  const isAdmin = isEditorialAdmin(user?.role);
  const owns = (r: Episode) => isAdmin || (user?.artistId != null && r.artistId === user.artistId);

  const fields: FieldConfig[] = [
    { name: "title", label: "Titre", type: "text", required: true },
    // superadmin choisit l'animateur ; pour un animateur l'API force lui-même.
    ...(isAdmin
      ? [
          {
            name: "artistId",
            label: "Animateur",
            type: "select" as const,
            required: true,
            options: artists.map((a) => ({ value: a.id, label: a.name })),
          },
        ]
      : []),
    { name: "description", label: "Description", type: "textarea" },
    { name: "season", label: "Saison", type: "number", half: true },
    { name: "episodeNumber", label: "N° épisode", type: "number", half: true },
    { name: "coverUrl", label: "URL pochette", type: "text" },
    { name: "status", label: "Statut", type: "select", half: true, options: STATUS_OPTIONS, default: "draft" },
    { name: "publishedAt", label: "Date publication (ISO)", type: "text", half: true, placeholder: "2026-06-18T12:00:00Z" },
  ];

  return (
    <div>
      <CrudPage<Episode>
        title="Podcasts"
        endpoint="/v1/admin/episodes"
        columns={columns}
        fields={fields}
        canCreate={isAdmin || user?.role === "animateur"}
        canEdit={owns}
        canDelete={owns}
        rowLabel={(r) => r.title}
        extraActions={(r, reload) =>
          owns(r) ? (
            <AudioUpload kind="episode" targetId={r.id} hasAudio={!!r.audioUrl} onDone={reload} />
          ) : null
        }
        toForm={(r) => ({
          title: r.title,
          artistId: r.artistId,
          description: r.description ?? "",
          season: r.season ?? "",
          episodeNumber: r.episodeNumber ?? "",
          coverUrl: r.coverUrl ?? "",
          status: r.status,
          publishedAt: r.publishedAt ?? "",
        })}
      />
      <p className="muted" style={{ marginTop: 16, fontSize: "0.85rem" }}>
        <span aria-hidden="true">💡</span> Le téléversement audio (S3) sera branché à l&apos;étape finale. Pour l&apos;instant, gère
        les métadonnées ; l&apos;audio s&apos;attachera ensuite.
      </p>
    </div>
  );
}
