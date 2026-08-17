"use client";

import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { isEditorialAdmin, type FeaturedItem } from "@/lib/types";

const API_PUBLIC = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8082";

const columns: Column<FeaturedItem>[] = [
  { key: "kind", label: "Type", render: (r) => (r.kind === "rail" ? "Rail" : "Homepage") },
  { key: "tag", label: "Tag", render: (r) => r.tag ?? "—" },
  { key: "title", label: "Titre" },
  { key: "sortOrder", label: "Ordre" },
  {
    key: "isPublished",
    label: "Statut",
    render: (r) => (r.isPublished ? "Publié" : "Masqué"),
  },
];

const fields: FieldConfig[] = [
  {
    name: "kind",
    label: "Emplacement",
    type: "select",
    half: true,
    options: [
      { value: "homepage", label: "Homepage (cartes)" },
      { value: "rail", label: "Rail « À la une »" },
    ],
    default: "homepage",
  },
  { name: "tag", label: "Tag", type: "text", half: true },
  { name: "title", label: "Titre", type: "text", required: true },
  { name: "meta", label: "Méta (horaire…)", type: "text" },
  { name: "body", label: "Texte", type: "textarea" },
  { name: "coverUrl", label: "Image (URL)", type: "text", half: true },
  { name: "emoji", label: "Emoji (rail)", type: "text", half: true, placeholder: "✨" },
  { name: "linkUrl", label: "Lien (optionnel)", type: "text" },
  {
    name: "variant",
    label: "Variante CSS",
    type: "select",
    half: true,
    options: [
      { value: "", label: "Défaut" },
      { value: "drive", label: "drive" },
      { value: "jumpoff", label: "jumpoff" },
      { value: "oksana", label: "oksana" },
    ],
  },
  { name: "sortOrder", label: "Ordre", type: "number", half: true, default: 0 },
  { name: "isPublished", label: "Publié", type: "checkbox", default: true },
];

export default function FeaturedPage() {
  const { user } = useAuth();
  const toast = useToast();

  if (!isEditorialAdmin(user?.role)) {
    return (
      <div>
        <div className="page-head"><h1>À la une</h1></div>
        <p className="muted">Réservé aux gestionnaires éditoriaux.</p>
      </div>
    );
  }

  return (
    <CrudPage<FeaturedItem>
      title="À la une"
      endpoint="/v1/admin/featured"
      columns={columns}
      fields={fields}
      canCreate
      canEdit={() => true}
      canDelete={() => true}
      rowLabel={(r) => r.title}
      toForm={(r) => ({
        kind: r.kind,
        tag: r.tag ?? "",
        title: r.title,
        meta: r.meta ?? "",
        body: r.body ?? "",
        coverUrl: r.coverUrl ?? "",
        emoji: r.emoji ?? "",
        linkUrl: r.linkUrl ?? "",
        variant: r.variant ?? "",
        sortOrder: r.sortOrder,
        isPublished: r.isPublished,
      })}
      extraActions={(row, reload) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(`${API_PUBLIC}/v1/featured?kind=${row.kind}`).then(() => {
              toast("URL API copiée ✓", "ok");
            });
          }}
        >
          Copier URL API
        </button>
      )}
    />
  );
}
