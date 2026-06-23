"use client";

/* Console OPÉRATEUR (owner En Ondes) : un seul écran pour TOUTES les radios —
   totaux agrégés (dont MRR), comparaison radio par radio, administrer /
   suspendre / provisionner / ÉDITER (forfait, prix, flux, note de facturation).
   Réservé au rôle owner (le backend refuse aussi pour les autres). */

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

function money(n: number | null | undefined): string {
  return n && n > 0 ? `${n} $/mois` : "—";
}

export default function ParcPage() {
  const { user } = useAuth();
  const { selectedId, selectRadio, refresh } = useRadio();
  const toast = useToast();
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [radios, setRadios] = useState<RadioSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RadioSummary | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", plan: "", monthlyPrice: "", streamUrl: "", nowPlayingUrl: "", domains: "" });

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
        monthlyPrice: form.monthlyPrice ? Number(form.monthlyPrice) : null,
        streamUrl: form.streamUrl || null,
        nowPlayingUrl: form.nowPlayingUrl || null,
        domains,
      });
      toast("Radio créée ✓ (statut : en montage)", "ok");
      setForm({ name: "", slug: "", plan: "", monthlyPrice: "", streamUrl: "", nowPlayingUrl: "", domains: "" });
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
        <Kpi label="MRR" value={`${overview.mrr} $`} sub="revenu mensuel récurrent" accent />
        <Kpi label="En direct" value={overview.live} sub="auditeurs maintenant" />
        <Kpi label="Aujourd'hui" value={overview.today} sub="visiteurs" />
        <Kpi label="Écoute cumulée" value={formatDuration(overview.listenSec)} />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Radio</th>
            <th>Statut</th>
            <th>Forfait</th>
            <th>Direct</th>
            <th>Jour</th>
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
                <span style={{ color: "#9aa", fontSize: 12 }}>{r.slug}</span>
              </td>
              <td>
                <span className={`status-dot ${r.status === "active" ? "status-published" : "status-archived"}`} />
                {STATUS_LABEL[r.status]}
              </td>
              <td>
                {r.plan || "—"}
                <br />
                <span style={{ color: "#9aa", fontSize: 12 }}>{money(r.monthlyPrice)}</span>
              </td>
              <td>{r.live}</td>
              <td>{r.today}</td>
              <td>{formatDuration(r.listenSec)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {r.artists} anim. · {r.shows} ém.
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button className="btn btn-sm" type="button" onClick={() => selectRadio(r.id)} disabled={selectedId === r.id}>
                  {selectedId === r.id ? "Administrée" : "Administrer"}
                </button>{" "}
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(r)}>
                  Éditer
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
        <Field label="Prix ($/mois)" value={form.monthlyPrice} onChange={(v) => setForm({ ...form, monthlyPrice: v })} type="number" />
        <Field label="Domaines (séparés par ,)" value={form.domains} onChange={(v) => setForm({ ...form, domains: v })} />
        <Field label="Flux audio (stream URL)" value={form.streamUrl} onChange={(v) => setForm({ ...form, streamUrl: v })} />
        <Field label="Now-playing URL" value={form.nowPlayingUrl} onChange={(v) => setForm({ ...form, nowPlayingUrl: v })} />
        <div style={{ gridColumn: "1 / -1" }}>
          <button className="btn" type="submit" disabled={creating || !form.name.trim()}>
            {creating ? "Création…" : "Créer la radio"}
          </button>
        </div>
      </form>

      {editing && (
        <RadioEditPanel
          radio={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── Panneau d'édition d'une radio (modal) ─────────────── */
function RadioEditPanel({
  radio,
  onClose,
  onSaved,
}: {
  radio: RadioSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: radio.name,
    status: radio.status as RadioStatus,
    plan: radio.plan ?? "",
    monthlyPrice: radio.monthlyPrice != null ? String(radio.monthlyPrice) : "",
    domains: (radio.domains ?? []).join(", "),
    streamUrl: radio.streamUrl ?? "",
    nowPlayingUrl: radio.nowPlayingUrl ?? "",
    billingNote: radio.billingNote ?? "",
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/v1/owner/radios/${radio.id}`, {
        name: f.name,
        status: f.status,
        plan: f.plan || null,
        monthlyPrice: f.monthlyPrice ? Number(f.monthlyPrice) : null,
        domains: f.domains.split(",").map((s) => s.trim()).filter(Boolean),
        streamUrl: f.streamUrl || null,
        nowPlayingUrl: f.nowPlayingUrl || null,
        billingNote: f.billingNote || null,
      });
      toast("Radio enregistrée ✓", "ok");
      onSaved();
    } catch (err) {
      toast((err as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: 40,
        zIndex: 50,
        overflow: "auto",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        style={{
          background: "var(--panel, #15151b)",
          border: "1px solid var(--border, #2a2a33)",
          borderRadius: 12,
          padding: 22,
          width: "min(620px, 100%)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>Éditer — {radio.name}</h2>
        <Field label="Nom" value={f.name} onChange={(v) => setF({ ...f, name: v })} required />
        <label style={{ display: "block", fontSize: 12, color: "#9aa" }}>
          Statut
          <select
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value as RadioStatus })}
            style={inputStyle}
          >
            <option value="active">Active</option>
            <option value="provisioning">En montage</option>
            <option value="paused">Suspendue</option>
          </select>
        </label>
        <Field label="Forfait" value={f.plan} onChange={(v) => setF({ ...f, plan: v })} />
        <Field label="Prix ($/mois)" value={f.monthlyPrice} onChange={(v) => setF({ ...f, monthlyPrice: v })} type="number" />
        <Field label="Domaines (séparés par ,)" value={f.domains} onChange={(v) => setF({ ...f, domains: v })} wide />
        <Field label="Flux audio (stream URL)" value={f.streamUrl} onChange={(v) => setF({ ...f, streamUrl: v })} wide />
        <Field label="Now-playing URL" value={f.nowPlayingUrl} onChange={(v) => setF({ ...f, nowPlayingUrl: v })} wide />
        <label style={{ display: "block", fontSize: 12, color: "#9aa", gridColumn: "1 / -1" }}>
          Note de facturation
          <textarea
            value={f.billingNote}
            onChange={(e) => setF({ ...f, billingNote: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, marginTop: 4 }}>
          <button className="btn" type="submit" disabled={saving || !f.name.trim()}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 6,
  background: "var(--panel2, #0f0f14)",
  color: "var(--txt, #eee)",
  border: "1px solid var(--border, #2a2a33)",
};

function Kpi({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: "var(--panel, #15151b)",
        border: `1px solid ${accent ? "var(--accent, #3aa0ff)" : "var(--border, #2a2a33)"}`,
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
  type = "text",
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label style={{ display: "block", fontSize: 12, color: "#9aa", gridColumn: wide ? "1 / -1" : undefined }}>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} style={inputStyle} />
    </label>
  );
}
