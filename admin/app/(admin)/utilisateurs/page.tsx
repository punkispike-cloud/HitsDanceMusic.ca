"use client";

import { useEffect, useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Spinner, Empty } from "@/components/ui";
import { roleAtLeast, ROLE_LABEL } from "@/lib/types";
import type { AdminUser, Artist } from "@/lib/types";

const columns: Column<AdminUser>[] = [
  { key: "displayName", label: "Nom" },
  { key: "email", label: "Email" },
  {
    key: "role",
    label: "Rôle",
    render: (r) => <span className={`role-badge role-${r.role}`}>{ROLE_LABEL[r.role]}</span>,
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
  const toast = useToast();
  const [artists, setArtists] = useState<Artist[] | null>(null);

  const sendInvite = async (id: string) => {
    try {
      const res = await api.post<{ invited: boolean; emailConfigured: boolean }>(
        `/v1/admin/users/${id}/invite`,
      );
      if (res.invited) toast("Invitation envoyée ✓", "ok");
      else if (!res.emailConfigured)
        toast("Email non configuré (Resend) — lien non envoyé.", "warn");
      else toast("Envoi impossible.", "error");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  };

  useEffect(() => {
    api.get<Artist[]>("/v1/admin/artists").then(setArtists).catch(() => setArtists([]));
  }, []);

  if (!user || !roleAtLeast(user.role, "superadmin")) {
    return (
      <div>
        <div className="page-head">
          <h1>Utilisateurs</h1>
        </div>
        <Empty label="Réservé aux administrateurs." />
      </div>
    );
  }
  if (!artists) return <Spinner />;

  // Le rôle « Propriétaire » (owner) n'est proposé qu'à un owner (anti-escalade,
  // miroir du bornage côté API).
  const roleOptions = [
    ...(user.role === "owner" ? [{ value: "owner", label: ROLE_LABEL.owner }] : []),
    { value: "superadmin", label: ROLE_LABEL.superadmin },
    { value: "animateur", label: ROLE_LABEL.animateur },
    { value: "lecteur", label: ROLE_LABEL.lecteur },
  ];

  // Champs création (POST /users) : email + password requis ; édition gérée à part.
  const fields: FieldConfig[] = [
    { name: "displayName", label: "Nom affiché", type: "text", required: true, half: true },
    { name: "email", label: "Email", type: "text", required: true, half: true },
    {
      name: "role",
      label: "Rôle",
      type: "select",
      half: true,
      options: roleOptions,
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
      hint: "Laisser vide pour envoyer plutôt une invitation par email (le membre choisit son mot de passe).",
    },
    {
      name: "invite",
      label: "Envoyer une invitation par email",
      type: "checkbox",
      default: true,
      hint: "Crée le compte inactif et envoie un lien « définir mon mot de passe » (nécessite Resend configuré).",
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
      extraActions={(row) => (
        <button className="btn btn-sm btn-ghost" onClick={() => void sendInvite(row.id)}>
          Inviter
        </button>
      )}
      toForm={(r) => ({
        displayName: r.displayName,
        email: r.email,
        role: r.role,
        artistId: r.artistId ?? "",
        password: "",
        invite: false,
        isActive: r.isActive,
      })}
    />
  );
}
