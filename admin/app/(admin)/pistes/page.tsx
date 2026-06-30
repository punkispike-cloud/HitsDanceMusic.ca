"use client";

import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { AudioUpload } from "@/components/audio-upload";
import { useAuth } from "@/lib/auth";
import { isEditorialAdmin, formatDuration, type Track } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "archived", label: "Archivé" },
];

const columns: Column<Track>[] = [
  { key: "artist", label: "Artiste" },
  { key: "title", label: "Titre" },
  { key: "genre", label: "Genre", render: (r) => r.genre ?? "—" },
  { key: "bpm", label: "BPM", render: (r) => (r.bpm ? Math.round(r.bpm) : "—") },
  {
    key: "durationSec",
    label: "Durée",
    render: (r) => (r.durationSec ? formatDuration(r.durationSec) : "—"),
  },
  {
    key: "audioUrl",
    label: "Audio",
    render: (r) =>
      r.audioUrl ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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

export default function PistesPage() {
  const { user } = useAuth();
  // Les pistes n'ont pas d'ownership par artiste (`artist` = texte libre) : tout
  // éditorial de la radio (animateur/superadmin/owner) peut gérer. `it` est exclu.
  const canManage = user?.role === "animateur" || isEditorialAdmin(user?.role);

  const fields: FieldConfig[] = [
    { name: "artist", label: "Artiste", type: "text", required: true, half: true },
    { name: "title", label: "Titre", type: "text", required: true, half: true },
    { name: "genre", label: "Genre", type: "text", half: true, placeholder: "house, disco…" },
    { name: "bpm", label: "BPM", type: "number", half: true, placeholder: "ex. 124" },
    { name: "source", label: "Source", type: "text", half: true, placeholder: "Pixabay / FMA / IA…" },
    { name: "license", label: "Licence", type: "text", half: true, placeholder: "CC0 / CC-BY / Pixabay" },
    { name: "status", label: "Statut", type: "select", half: true, options: STATUS_OPTIONS, default: "draft" },
  ];

  return (
    <div>
      <CrudPage<Track>
        title="Pistes (bibliothèque du studio)"
        endpoint="/v1/admin/library"
        columns={columns}
        fields={fields}
        canCreate={canManage}
        canEdit={() => canManage}
        canDelete={() => canManage}
        rowLabel={(r) => `${r.artist} — ${r.title}`}
        extraActions={(r, reload) =>
          canManage ? (
            <AudioUpload kind="track" targetId={r.id} hasAudio={!!r.audioUrl} currentBpm={r.bpm} onDone={reload} />
          ) : null
        }
        toForm={(r) => ({
          artist: r.artist,
          title: r.title,
          genre: r.genre ?? "",
          bpm: r.bpm ?? "",
          source: r.source ?? "",
          license: r.license ?? "",
          status: r.status,
        })}
      />
    </div>
  );
}
