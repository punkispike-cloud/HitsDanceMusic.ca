"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
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
    render: (r) => (r.audioUrl ? "🎵 prêt" : <span className="muted">à téléverser</span>),
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

  useEffect(() => {
    api.get<Artist[]>("/v1/admin/artists").then(setArtists).catch(() => setArtists([]));
  }, []);

  if (!artists) return <Spinner />;
  const isAdmin = user?.role === "superadmin";
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
        💡 Le téléversement audio (S3) sera branché à l&apos;étape finale. Pour l&apos;instant, gère
        les métadonnées ; l&apos;audio s&apos;attachera ensuite.
      </p>
    </div>
  );
}
