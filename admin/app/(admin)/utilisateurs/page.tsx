"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, Empty } from "@/components/ui";
import type { AdminUser, Artist } from "@/lib/types";

const columns: Column<AdminUser>[] = [
  { key: "displayName", label: "Nom" },
  { key: "email", label: "Email" },
  {
    key: "role",
    label: "Rôle",
    render: (r) => <span className={`role-badge role-${r.role}`}>{r.role}</span>,
  },
  {
    key: "isActive",
    label: "Actif",
    render: (r) => (
      <span>
        <span className={`status-dot ${r.isActive ? "status-published" : "status-archived"}`} />
        {r.isActive ? "Oui" : "Non"}
      </span>
    ),
  },
  {
    key: "lastLoginAt",
    label: "Dernière connexion",
    render: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString("fr-CA") : "—"),
  },
];

export default function UtilisateursPage() {
  const { user } = useAuth();
  const [artists, setArtists] = useState<Artist[] | null>(null);

  useEffect(() => {
    api.get<Artist[]>("/v1/admin/artists").then(setArtists).catch(() => setArtists([]));
  }, []);

  if (user?.role !== "superadmin") {
    return (
      <div>
        <div className="page-head">
          <h1>Utilisateurs</h1>
        </div>
        <Empty label="Réservé aux super-administrateurs." />
      </div>
    );
  }
  if (!artists) return <Spinner />;

  // Champs création (POST /users) : email + password requis ; édition gérée à part.
  const fields: FieldConfig[] = [
    { name: "displayName", label: "Nom affiché", type: "text", required: true, half: true },
    { name: "email", label: "Email", type: "text", required: true, half: true },
    {
      name: "role",
      label: "Rôle",
      type: "select",
      half: true,
      options: [
        { value: "superadmin", label: "Super admin" },
        { value: "animateur", label: "Animateur" },
        { value: "lecteur", label: "Lecteur" },
      ],
      default: "lecteur",
    },
    {
      name: "artistId",
      label: "Fiche animateur liée",
      type: "select",
      half: true,
      options: artists.map((a) => ({ value: a.id, label: a.name })),
    },
    {
      name: "password",
      label: "Mot de passe (≥ 12 car.)",
      type: "text",
      hint: "Requis à la création. Laisser vide en édition ne change pas le mot de passe.",
    },
    { name: "isActive", label: "Compte actif", type: "checkbox", default: true },
  ];

  return (
    <CrudPage<AdminUser>
      title="Utilisateurs"
      endpoint="/v1/admin/users"
      columns={columns}
      fields={fields}
      rowLabel={(r) => r.email}
      canDelete={(r) => r.id !== user.id}
      toForm={(r) => ({
        displayName: r.displayName,
        email: r.email,
        role: r.role,
        artistId: r.artistId ?? "",
        password: "",
        isActive: r.isActive,
      })}
    />
  );
}
