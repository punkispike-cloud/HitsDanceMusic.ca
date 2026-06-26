"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, ErrorState } from "@/components/ui";
import { AudioUpload } from "@/components/audio-upload";
import type { Artist, Mix } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "archived", label: "Archivé" },
];

const columns: Column<Mix>[] = [
  { key: "title", label: "Titre" },
  { key: "genre", label: "Genre", render: (r) => r.genre ?? "—" },
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
];

export default function MixesPage() {
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
  const isAdmin = user?.role === "superadmin";
  const owns = (r: Mix) => isAdmin || (user?.artistId != null && r.artistId === user.artistId);

  const fields: FieldConfig[] = [
    { name: "title", label: "Titre", type: "text", required: true },
    ...(isAdmin
      ? [
          {
            name: "artistId",
            label: "Animateur / DJ",
            type: "select" as const,
            required: true,
            options: artists.map((a) => ({ value: a.id, label: a.name })),
          },
        ]
      : []),
    { name: "genre", label: "Genre", type: "text", half: true, placeholder: "house, disco…" },
    { name: "status", label: "Statut", type: "select", half: true, options: STATUS_OPTIONS, default: "draft" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "coverUrl", label: "URL pochette", type: "text" },
    { name: "publishedAt", label: "Date publication (ISO)", type: "text", placeholder: "2026-06-18T12:00:00Z" },
  ];

  return (
    <div>
      <CrudPage<Mix>
        title="Mixes / DJ sets"
        endpoint="/v1/admin/mixes"
        columns={columns}
        fields={fields}
        canCreate={isAdmin || user?.role === "animateur"}
        canEdit={owns}
        canDelete={owns}
        rowLabel={(r) => r.title}
        extraActions={(r, reload) =>
          owns(r) ? (
            <AudioUpload kind="mix" targetId={r.id} hasAudio={!!r.audioUrl} onDone={reload} />
          ) : null
        }
        toForm={(r) => ({
          title: r.title,
          artistId: r.artistId,
          genre: r.genre ?? "",
          status: r.status,
          description: r.description ?? "",
          coverUrl: r.coverUrl ?? "",
          publishedAt: r.publishedAt ?? "",
        })}
      />
      <p className="muted" style={{ marginTop: 16, fontSize: "0.85rem" }}>
        <span aria-hidden="true">💡</span> Téléversement audio + tracklist détaillée : branchés à l&apos;étape finale (S3).
      </p>
    </div>
  );
}
