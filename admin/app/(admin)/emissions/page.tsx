"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";
import { SLOT_TAGS, tagColor, type Artist, type Show } from "@/lib/types";

const columns: Column<Show>[] = [
  { key: "title", label: "Titre" },
  {
    key: "tag",
    label: "Tag",
    render: (r) =>
      r.tag ? (
        <span className="tag" style={{ background: tagColor(r.tag) }}>
          {SLOT_TAGS.find((t) => t.value === r.tag)?.label ?? r.tag}
        </span>
      ) : (
        "—"
      ),
  },
  { key: "scheduleText", label: "Horaire", render: (r) => r.scheduleText ?? "—" },
  {
    key: "isPublished",
    label: "Statut",
    render: (r) => (
      <span>
        <span className={`status-dot ${r.isPublished ? "status-published" : "status-draft"}`} />
        {r.isPublished ? "Publié" : "Masqué"}
      </span>
    ),
  },
];

export default function EmissionsPage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);

  useEffect(() => {
    api.get<Artist[]>("/v1/admin/artists").then(setArtists).catch(() => setArtists([]));
  }, []);

  if (!artists) return <Spinner />;

  const fields: FieldConfig[] = [
    { name: "title", label: "Titre", type: "text", required: true },
    { name: "slug", label: "Slug (auto si vide)", type: "text", half: true },
    {
      name: "tag",
      label: "Tag / couleur",
      type: "select",
      half: true,
      options: SLOT_TAGS.map((t) => ({ value: t.value, label: t.label })),
    },
    { name: "badge", label: "Badge", type: "text", half: true, placeholder: "Matin · Live" },
    {
      name: "artistId",
      label: "Animateur",
      type: "select",
      half: true,
      options: artists.map((a) => ({ value: a.id, label: a.name })),
    },
    { name: "scheduleText", label: "Horaire (texte)", type: "text" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "sortOrder", label: "Ordre", type: "number", half: true, default: 0 },
    { name: "isPublished", label: "Publié", type: "checkbox", default: true },
  ];

  const isAdmin = user?.role === "superadmin";
  const owns = (r: Show) => isAdmin || (user?.artistId != null && r.artistId === user.artistId);

  return (
    <CrudPage<Show>
      title="Émissions"
      endpoint="/v1/admin/shows"
      columns={columns}
      fields={fields}
      canCreate={isAdmin || user?.role === "animateur"}
      canEdit={owns}
      canDelete={owns}
      rowLabel={(r) => r.title}
      toForm={(r) => ({
        title: r.title,
        slug: r.slug,
        tag: r.tag ?? "",
        badge: r.badge ?? "",
        artistId: r.artistId ?? "",
        scheduleText: r.scheduleText ?? "",
        description: r.description ?? "",
        sortOrder: r.sortOrder,
        isPublished: r.isPublished,
      })}
    />
  );
}
