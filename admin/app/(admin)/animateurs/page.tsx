"use client";

import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { useAuth } from "@/lib/auth";
import type { Artist } from "@/lib/types";

const fields: FieldConfig[] = [
  { name: "name", label: "Nom", type: "text", required: true, half: true },
  { name: "slug", label: "Slug (auto si vide)", type: "text", half: true, placeholder: "alain-perron" },
  { name: "showTitle", label: "Émission principale", type: "text", half: true },
  { name: "scheduleText", label: "Horaire (texte)", type: "text", half: true, placeholder: "Lun–Ven · 07h00–09h00" },
  { name: "photoUrl", label: "URL photo", type: "text", placeholder: "assets/alain-perron.webp" },
  { name: "initials", label: "Initiales (avatar texte)", type: "text", half: true, placeholder: "AP" },
  { name: "sortOrder", label: "Ordre d'affichage", type: "number", half: true, default: 0 },
  { name: "bio", label: "Bio", type: "textarea" },
  { name: "isPublished", label: "Publié sur le site", type: "checkbox", default: true },
];

const columns: Column<Artist>[] = [
  { key: "name", label: "Nom" },
  { key: "showTitle", label: "Émission", render: (r) => r.showTitle ?? "—" },
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

export default function AnimateursPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "superadmin";

  return (
    <CrudPage<Artist>
      title="Animateurs"
      endpoint="/v1/admin/artists"
      columns={columns}
      fields={fields}
      canCreate={isAdmin}
      canDelete={() => isAdmin}
      // superadmin édite tout ; un animateur édite uniquement SA fiche
      canEdit={(row) => isAdmin || user?.artistId === row.id}
      rowLabel={(r) => r.name}
      toForm={(r) => ({
        name: r.name,
        slug: r.slug,
        showTitle: r.showTitle ?? "",
        scheduleText: r.scheduleText ?? "",
        photoUrl: r.photoUrl ?? "",
        initials: r.initials ?? "",
        sortOrder: r.sortOrder,
        bio: r.bio ?? "",
        isPublished: r.isPublished,
      })}
    />
  );
}
