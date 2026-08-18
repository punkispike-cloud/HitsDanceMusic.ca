"use client";

/* Boîte de réception des demandes — table desktop + cartes mobile. */

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRequests } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Empty, Forbidden, ErrorState, TableSkeleton } from "@/components/ui";
import { isEditorialAdmin, type RequestStatus, type SongRequest } from "@/lib/types";

const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "Nouvelle",
  read: "Lue",
  queued: "En file",
  played: "Jouée",
  ignored: "Ignorée",
};

function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`} aria-label={`Statut : ${STATUS_LABEL[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const FILTERS: { value: "" | RequestStatus; label: string }[] = [
  { value: "new", label: "Nouvelles" },
  { value: "", label: "Toutes" },
  { value: "queued", label: "En file" },
  { value: "played", label: "Jouées" },
  { value: "ignored", label: "Ignorées" },
];

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

function ActionButtons({
  r,
  busy,
  canHandle,
  onStatus,
}: {
  r: SongRequest;
  busy: string | null;
  canHandle: boolean;
  onStatus: (id: string, status: RequestStatus) => void;
}) {
  if (!canHandle) return null;
  return (
    <div className="req-actions">
      {r.status !== "read" && (
        <button className="btn btn-ghost btn-sm" disabled={busy === r.id} aria-label={`Marquer « ${r.title} » comme lue`} onClick={() => void onStatus(r.id, "read")}>
          Lu
        </button>
      )}
      {r.status !== "queued" && (
        <button className="btn btn-sm" disabled={busy === r.id} aria-label={`Mettre « ${r.title} » en file`} onClick={() => void onStatus(r.id, "queued")}>
          En file
        </button>
      )}
      {r.status !== "played" && (
        <button className="btn btn-primary btn-sm" disabled={busy === r.id} aria-label={`Marquer « ${r.title} » comme jouée`} onClick={() => void onStatus(r.id, "played")}>
          Jouée
        </button>
      )}
      {r.status !== "ignored" && (
        <button className="btn btn-ghost btn-sm" disabled={busy === r.id} aria-label={`Ignorer la demande « ${r.title} »`} onClick={() => void onStatus(r.id, "ignored")}>
          Ignorer
        </button>
      )}
    </div>
  );
}

export default function DemandesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<"" | RequestStatus>("new");
  const { data, error, mutate } = useRequests(filter || undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const canHandle = user?.role === "animateur" || isEditorialAdmin(user?.role);
  const loadError = error ? "Impossible de charger la file de demandes." : null;

  if (user?.role === "it" || user?.role === "lecteur") {
    return (
      <div>
        <div className="page-head">
          <h1>Demandes</h1>
        </div>
        <Forbidden
          label="Réservé aux animateurs et gestionnaires."
          hint="La file de demandes contient des données d'auditeurs : accès limité à l'antenne et à la gestion."
        />
      </div>
    );
  }

  const setStatus = async (id: string, status: RequestStatus) => {
    setBusy(id);
    try {
      await api.patch(`/v1/admin/requests/${id}`, { status });
      await mutate();
      toast(`${STATUS_LABEL[status]} ✓`, "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="demandes-page">
      <div className="page-head">
        <h1>Demandes &amp; dédicaces</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            aria-label="Filtrer par statut"
            value={filter}
            onChange={(e) => setFilter(e.target.value as "" | RequestStatus)}
            style={{ width: 150 }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
            />
            temps-réel (5 s)
          </span>
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
        Demandes de titres et dédicaces déposées par les auditeurs depuis le site public.
        {canHandle ? " Traite-les à l'antenne : en file, jouée ou ignorée." : " Lecture seule pour ton rôle."}
      </p>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void mutate()} />
      ) : !data ? (
        <TableSkeleton cols={canHandle ? 6 : 5} />
      ) : data.length === 0 ? (
        <Empty
          label="Aucune demande dans cette vue."
          hint="Les nouvelles demandes des auditeurs apparaîtront ici automatiquement."
        />
      ) : (
        <>
          <div className="table-wrap demandes-table">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Titre</th>
                  <th scope="col">Dédicace</th>
                  <th scope="col">De</th>
                  <th scope="col">Reçue</th>
                  <th scope="col">Statut</th>
                  {canHandle && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((r: SongRequest) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{r.title}</div>
                      <div className="muted" style={{ fontSize: "0.78rem" }}>
                        {r.artist || "—"}
                      </div>
                    </td>
                    <td className="muted" style={{ maxWidth: 280 }}>
                      {r.dedication || "—"}
                    </td>
                    <td className="muted">{r.requesterName || "Anonyme"}</td>
                    <td className="muted" title={new Date(r.createdAt).toLocaleString("fr-CA")}>
                      {timeAgo(r.createdAt)}
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    {canHandle && (
                      <td>
                        <ActionButtons r={r} busy={busy} canHandle={canHandle} onStatus={setStatus} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="demandes-cards" aria-label="Demandes (vue mobile)">
            {data.map((r: SongRequest) => (
              <article key={r.id} className="card demande-card">
                <header className="demande-card-head">
                  <div>
                    <strong>{r.title}</strong>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>{r.artist || "—"}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </header>
                {r.dedication && <p className="muted" style={{ fontSize: "0.85rem", margin: "8px 0" }}>{r.dedication}</p>}
                <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
                  {r.requesterName || "Anonyme"} · {timeAgo(r.createdAt)}
                </p>
                <ActionButtons r={r} busy={busy} canHandle={canHandle} onStatus={setStatus} />
              </article>
            ))}
          </div>
        </>
      )}

      {canHandle && data && data.length > 0 && (
        <div className="demandes-sticky-bar" role="toolbar" aria-label="Actions rapides">
          <span className="muted" style={{ fontSize: "0.82rem" }}>{data.length} demande(s) affichée(s)</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void mutate()}>
            Actualiser
          </button>
        </div>
      )}
    </div>
  );
}
