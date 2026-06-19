"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Spinner, Empty } from "@/components/ui";
import type { AuditEntry, AuditResponse } from "@/lib/types";

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
  const [data, setData] = useState<AuditResponse | null>(null);
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (entity) qs.set("entity", entity);
    if (action) qs.set("action", action);
    qs.set("limit", "150");
    try {
      setData(await api.get<AuditResponse>(`/v1/admin/audit?${qs.toString()}`));
    } catch {
      setData({ rows: [], total: 0, limit: 0, offset: 0 });
    }
  }, [entity, action]);

  useEffect(() => {
    void load();
  }, [load]);

  if (user?.role !== "superadmin") {
    return (
      <div>
        <div className="page-head">
          <h1>Journal d&apos;audit</h1>
        </div>
        <Empty label="Réservé aux super-administrateurs." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1>Journal d&apos;audit</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 150 }}>
            <option value="">Toutes entités</option>
            <option value="artists">Animateurs</option>
            <option value="shows">Émissions</option>
            <option value="schedule-slots">Grille</option>
            <option value="episodes">Podcasts</option>
            <option value="mixes">Mixes</option>
            <option value="users">Utilisateurs</option>
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 140 }}>
            <option value="">Toutes actions</option>
            <option value="create">Création</option>
            <option value="update">Modification</option>
            <option value="delete">Suppression</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
            ↻
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
        Trace de toutes les modifications faites depuis la console. Conservé 1 an.
      </p>

      {!data ? (
        <Spinner />
      ) : data.rows.length === 0 ? (
        <Empty label="Aucune entrée pour ces filtres." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Acteur</th>
                <th>Action</th>
                <th>Entité</th>
                <th>ID</th>
                <th>IP</th>
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
