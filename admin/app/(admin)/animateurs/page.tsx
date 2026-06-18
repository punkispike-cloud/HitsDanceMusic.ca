"use client";

import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { useAuth } from "@/lib/auth";
import type { Artist } from "@/lib/types";

const SOCIAL_KEYS = ["instagram", "facebook", "tiktok", "youtube", "website"] as const;

const fields: FieldConfig[] = [
  { name: "name", label: "Nom", type: "text", required: true, half: true },
  { name: "slug", label: "Slug (auto si vide)", type: "text", half: true, placeholder: "alain-perron" },
  { name: "showTitle", label: "Émission principale", type: "text", half: true },
  { name: "scheduleText", label: "Horaire (texte)", type: "text", half: true, placeholder: "Lun–Ven · 07h00–09h00" },
  { name: "photoUrl", label: "Photo de profil", type: "image", placeholder: "assets/alain-perron.webp ou téléverser" },
  { name: "initials", label: "Initiales (si pas de photo)", type: "text", half: true, placeholder: "AP" },
  { name: "sortOrder", label: "Ordre d'affichage", type: "number", half: true, default: 0 },
  { name: "bio", label: "Bio", type: "textarea" },
  // Réseaux sociaux (regroupés en `socials` via transformPayload)
  { name: "instagram", label: "Instagram (URL)", type: "text", half: true, placeholder: "https://instagram.com/…" },
  { name: "facebook", label: "Facebook (URL)", type: "text", half: true, placeholder: "https://facebook.com/…" },
  { name: "tiktok", label: "TikTok (URL)", type: "text", half: true, placeholder: "https://tiktok.com/@…" },
  { name: "youtube", label: "YouTube (URL)", type: "text", half: true, placeholder: "https://youtube.com/@…" },
  { name: "website", label: "Site web (URL)", type: "text", placeholder: "https://…" },
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
      transformPayload={(payload, values) => {
        const socials: Record<string, string> = {};
        for (const k of SOCIAL_KEYS) {
          const v = values[k];
          if (typeof v === "string" && v.trim()) socials[k] = v.trim();
          delete payload[k];
        }
        payload.socials = socials;
        return payload;
      }}
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
        instagram: r.socials?.instagram ?? "",
        facebook: r.socials?.facebook ?? "",
        tiktok: r.socials?.tiktok ?? "",
        youtube: r.socials?.youtube ?? "",
        website: r.socials?.website ?? "",
      })}
    />
  );
}
