"use client";

/* Console OPÉRATEUR (owner En Ondes) : un seul écran pour TOUTES les radios —
   totaux agrégés, comparaison radio par radio, administrer / suspendre /
   provisionner. Réservé au rôle owner (le backend refuse aussi pour les autres). */

import { useEffect, useState, useCallback, type ReactNode, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { useToast } from "@/components/toast";
import { Spinner, Empty } from "@/components/ui";
import { formatDuration, type RadioSummary, type OwnerOverview, type RadioStatus } from "@/lib/types";

const STATUS_LABEL: Record<RadioStatus, string> = {
  active: "Active",
  provisioning: "En montage",
  paused: "Suspendue",
};

export default function ParcPage() {
  const { user } = useAuth();
  const { selectedId, selectRadio, refresh } = useRadio();
  const toast = useToast();
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [radios, setRadios] = useState<RadioSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", plan: "", streamUrl: "", nowPlayingUrl: "", domains: "" });

  const isOwner = user?.role === "owner";

  const load = useCallback(() => {
    api.get<OwnerOverview>("/v1/owner/overview").then(setOverview).catch(() => setOverview(null));
    api.get<RadioSummary[]>("/v1/owner/radios").then(setRadios).catch(() => setRadios([]));
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (!isOwner) {
    return (
      <div>
        <div className="page-head">
          <h1>Parc</h1>
        </div>
        <Empty label="Réservé à l'opérateur (En Ondes)." />
      </div>
    );
  }
  if (!radios || !overview) return <Spinner />;

  const setStatus = async (r: RadioSummary, status: RadioStatus) => {
    try {
      await api.patch(`/v1/owner/radios/${r.id}`, { status });
      toast("Radio mise à jour ✓", "ok");
      load();
      refresh();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  };

  const createRadio = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const domains = form.domains.split(",").map((s) => s.trim()).filter(Boolean);
      await api.post("/v1/owner/radios", {
        name: form.name,
        slug: form.slug || undefined,
        plan: form.plan || null,
        streamUrl: form.streamUrl || null,
        nowPlayingUrl: form.nowPlayingUrl || null,
        domains,
      });
      toast("Radio créée ✓ (statut : en montage)", "ok");
      setForm({ name: "", slug: "", plan: "", streamUrl: "", nowPlayingUrl: "", domains: "" });
      load();
      refresh();
    } catch (err) {
      toast((err as ApiError).message, "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Parc — toutes tes radios</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
      >
        <Kpi label="Radios" value={`${overview.activeRadios}/${overview.radios}`} sub="actives / total" />
        <Kpi label="En direct" value={overview.live} sub="auditeurs maintenant" />
        <Kpi label="Aujourd'hui" value={overview.today} sub="visiteurs" />
        <Kpi label="Visiteurs (total)" value={overview.sessions} />
        <Kpi label="Écoute cumulée" value={formatDuration(overview.listenSec)} />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Radio</th>
            <th>Statut</th>
            <th>Direct</th>
            <th>Jour</th>
            <th>Visiteurs</th>
            <th>Écoute</th>
            <th>Contenu</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {radios.map((r) => (
            <tr key={r.id} style={selectedId === r.id ? { outline: "1px solid var(--accent, #3aa0ff)" } : undefined}>
              <td>
                <strong>{r.name}</strong>
                <br />
                <span style={{ color: "#9aa", fontSize: 12 }}>
                  {r.slug}
                  {r.plan ? ` · ${r.plan}` : ""}
                </span>
              </td>
              <td>
                <span className={`status-dot ${r.status === "active" ? "status-published" : "status-archived"}`} />
                {STATUS_LABEL[r.status]}
              </td>
              <td>{r.live}</td>
              <td>{r.today}</td>
              <td>{r.sessions}</td>
              <td>{formatDuration(r.listenSec)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.artists} anim. · {r.shows} ém.
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => selectRadio(r.id)}
                  disabled={selectedId === r.id}
                >
                  {selectedId === r.id ? "Administrée" : "Administrer"}
                </button>{" "}
                {r.status !== "active" ? (
                  <button className="btn btn-sm btn-ghost" type="button" onClick={() => void setStatus(r, "active")}>
                    Activer
                  </button>
                ) : (
                  <button className="btn btn-sm btn-ghost" type="button" onClick={() => void setStatus(r, "paused")}>
                    Suspendre
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 28 }}>Provisionner une nouvelle radio</h2>
      <p style={{ color: "#9aa", fontSize: 13, marginTop: -6 }}>
        Crée le tenant (statut « en montage »). Le branchement du flux AzuraCast viendra automatiser le reste.
      </p>
      <form
        onSubmit={createRadio}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, maxWidth: 780 }}
      >
        <Field label="Nom *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Field label="Slug (auto si vide)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
        <Field label="Forfait" value={form.plan} onChange={(v) => setForm({ ...form, plan: v })} />
        <Field label="Domaines (séparés par ,)" value={form.domains} onChange={(v) => setForm({ ...form, domains: v })} />
        <Field label="Flux audio (stream URL)" value={form.streamUrl} onChange={(v) => setForm({ ...form, streamUrl: v })} />
        <Field label="Now-playing URL" value={form.nowPlayingUrl} onChange={(v) => setForm({ ...form, nowPlayingUrl: v })} />
        <div style={{ gridColumn: "1 / -1" }}>
          <button className="btn" type="submit" disabled={creating || !form.name.trim()}>
            {creating ? "Création…" : "Créer la radio"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: "var(--panel, #15151b)",
        border: "1px solid var(--border, #2a2a33)",
      }}
    >
      <div style={{ fontSize: 12, color: "#9aa" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#778" }}>{sub}</div>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label style={{ display: "block", fontSize: 12, color: "#9aa" }}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        style={{
          width: "100%",
          marginTop: 4,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--panel2, #0f0f14)",
          color: "var(--txt, #eee)",
          border: "1px solid var(--border, #2a2a33)",
        }}
      />
    </label>
  );
}
