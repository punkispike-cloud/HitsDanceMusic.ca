"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAudit } from "@/lib/hooks";
import { Empty, Forbidden, ErrorState, TableSkeleton } from "@/components/ui";
import { isCrossRadio } from "@/lib/types";
import type { AuditEntry } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
};
const ACTION_COLOR: Record<string, string> = {
  create: "var(--ok)",
  update: "var(--accent)",
  delete: "var(--danger)",
};

export default function JournalPage() {
  const { user } = useAuth();
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  // Clé incluant les filtres (encodés dans le chemin query) + selectedRadioId :
  // changer un filtre ou la radio change la clé → re-fetch automatique.
  const { data, error, mutate } = useAudit(entity, action);
  const loadError = error ? "Impossible de charger le journal d'audit." : null;

  // QW-1 — Filtres persistés dans l'URL : lecture au montage…
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get("entity");
    const a = sp.get("action");
    if (e) setEntity(e);
    if (a) setAction(a);
  }, []);

  // …puis réécriture à chaque changement de filtre (replaceState).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    entity ? sp.set("entity", entity) : sp.delete("entity");
    action ? sp.set("action", action) : sp.delete("action");
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [entity, action]);

  // Page technique/audit : owner (god mode) + it (monitoring cross-radio) +
  // superadmin (de sa radio). Les autres rôles → 403.
  if (!(isCrossRadio(user?.role) || user?.role === "superadmin")) {
    return (
      <div>
        <div className="page-head">
          <h1>Journal d&apos;audit</h1>
        </div>
        <Forbidden label="Réservé aux gestionnaires et à l'équipe IT." hint="Le journal d'audit n'est accessible qu'aux gestionnaires, à l'équipe IT et au propriétaire En Ondes." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1>Journal d&apos;audit</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <select aria-label="Filtrer par entité" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 150 }}>
            <option value="">Toutes entités</option>
            <option value="artists">Animateurs</option>
            <option value="shows">Émissions</option>
            <option value="schedule-slots">Grille</option>
            <option value="episodes">Podcasts</option>
            <option value="mixes">Mixes</option>
            <option value="users">Utilisateurs</option>
          </select>
          <select aria-label="Filtrer par action" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 140 }}>
            <option value="">Toutes actions</option>
            <option value="create">Création</option>
            <option value="update">Modification</option>
            <option value="delete">Suppression</option>
          </select>
          <button className="btn btn-ghost btn-sm" aria-label="Rafraîchir le journal" onClick={() => void mutate()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
        Trace de toutes les modifications faites depuis la console. Conservé 1 an.
      </p>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void mutate()} />
      ) : !data ? (
        <TableSkeleton cols={6} />
      ) : data.rows.length === 0 ? (
        <Empty label="Aucune entrée pour ces filtres." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Acteur</th>
                <th scope="col">Action</th>
                <th scope="col">Entité</th>
                <th scope="col">ID</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: AuditEntry) => (
                <tr key={r.id}>
                  <td className="muted">{new Date(r.createdAt).toLocaleString("fr-CA")}</td>
                  <td>
                    {r.actorName ?? "—"}
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {r.actorEmail}
                    </div>
                  </td>
                  <td>
                    <span style={{ color: ACTION_COLOR[r.action] ?? "var(--txt)", fontWeight: 700 }}>
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                  </td>
                  <td>{r.entity}</td>
                  <td className="muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: "0.78rem" }}>
                    {r.entityId ? r.entityId.slice(0, 8) : "—"}
                  </td>
                  <td className="muted">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
