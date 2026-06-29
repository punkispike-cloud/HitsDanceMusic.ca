"use client";

/* Console OPÉRATEUR (En Ondes) : un seul écran pour TOUTES les radios —
   totaux agrégés (dont MRR), comparaison radio par radio, administrer /
   suspendre / provisionner / ÉDITER (forfait, prix, flux, note de facturation).
   Accès cross-radio : owner (god mode, + actions commerciales) + it (monitoring
   technique SANS actions commerciales — provisioning/billing masqués). */

import { useEffect, useState, useCallback, useRef, useId, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { useToast } from "@/components/toast";
import { Empty, ErrorState, TableSkeleton, Modal } from "@/components/ui";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import {
  formatDuration,
  isCrossRadio,
  type RadioSummary,
  type OwnerOverview,
  type RadioStatus,
  type RadioHealth,
  type OwnerTimeseriesPoint,
} from "@/lib/types";

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
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RadioSummary | null>(null);
  // Confirmation de changement de statut (couper/relancer le direct).
  const [confirmStatus, setConfirmStatus] = useState<{ radio: RadioSummary; status: RadioStatus } | null>(null);
  const [health, setHealth] = useState<Record<string, RadioHealth>>({});
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", plan: "", monthlyPrice: "", streamUrl: "", nowPlayingUrl: "", domains: "" });

  // Accès cross-radio (owner + it). Les actions commerciales (provisioning,
  // édition, statut, export CSV) restent réservées à l'owner.
  const crossRadio = isCrossRadio(user?.role);
  const isOwner = user?.role === "owner";

  const load = useCallback(() => {
    // Chargement: en cas d'échec on garde radios=null + error (ne PAS confondre erreur et vide).
    setError(null);
    Promise.all([
      api.get<OwnerOverview>("/v1/owner/overview"),
      api.get<RadioSummary[]>("/v1/owner/radios"),
    ])
      .then(([ov, rs]) => {
        setOverview(ov);
        setRadios(rs);
      })
      .catch((e) => {
        setRadios(null);
        setOverview(null);
        setError((e as ApiError).message || "Impossible de charger le parc.");
      });
    // Données secondaires (santé / courbe): non bloquantes pour l'affichage de la table.
    api
      .get<RadioHealth[]>("/v1/owner/health")
      .then((h) => setHealth(Object.fromEntries(h.map((x) => [x.id, x]))))
      .catch(() => setHealth({}));
    api
      .get<OwnerTimeseriesPoint[]>("/v1/owner/timeseries?days=30")
      .then((rows) => setSeries(rows.map((r) => ({ day: r.day, value: r.sessions }))))
      .catch(() => setSeries([]));
  }, []);

  useEffect(() => {
    if (crossRadio) load();
  }, [crossRadio, load]);

  if (!crossRadio) {
    return (
      <div>
        <div className="page-head">
          <h1>Parc</h1>
        </div>
        <Empty label="Réservé à l'opérateur (En Ondes) et à l'équipe IT." />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (radios === null || overview === null) return <TableSkeleton cols={8} />;

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

  const exportCsv = () => {
    if (!radios) return;
    const esc = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Radio", "Slug", "Statut", "Forfait", "Prix_$/mois", "Contact_nom", "Contact_courriel", "Contact_tel", "Auditeurs_jour", "Visiteurs_total", "Licences_OK"];
    const lines = [head.join(",")];
    for (const r of radios)
      lines.push(
        [r.name, r.slug, r.status, r.plan ?? "", r.monthlyPrice ?? "", r.contactName ?? "", r.contactEmail ?? "", r.contactPhone ?? "", r.today, r.sessions, r.licenseConfirmed ? "oui" : "non"]
          .map(esc)
          .join(","),
      );
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parc-en-ondes.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Erreurs de validation par champ (aria-invalid + aria-describedby).
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Le nom est requis.";
    if (form.monthlyPrice) {
      const n = Number(form.monthlyPrice);
      if (!Number.isFinite(n) || n < 0) errs.monthlyPrice = "Prix invalide (doit être ≥ 0).";
    }
    const isUrl = (v: string) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    };
    if (form.streamUrl && !isUrl(form.streamUrl)) errs.streamUrl = "URL invalide (ex. https://…).";
    if (form.nowPlayingUrl && !isUrl(form.nowPlayingUrl)) errs.nowPlayingUrl = "URL invalide (ex. https://…).";
    return errs;
  };

  const createRadio = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateForm();
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Focus sur le premier champ fautif.
      const first = Object.keys(errs)[0]!;
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
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
      setFormErrors({});
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

      <AlertsPanel radios={radios} health={health} />

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
        <Kpi label="ARR (projeté)" value={`${overview.mrr * 12} $`} sub="revenu annuel" />
        <Kpi label="En direct" value={overview.live} sub="auditeurs maintenant" />
        <Kpi label="Aujourd'hui" value={overview.today} sub="visiteurs" />
        <Kpi label="Écoute cumulée" value={formatDuration(overview.listenSec)} />
      </div>

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>Visiteurs — 30 derniers jours (tout le parc)</strong>
          {isOwner && (
            <button className="btn btn-sm btn-ghost" type="button" onClick={exportCsv}>
              <span aria-hidden="true">⬇</span> Export CSV
            </button>
          )}
        </div>
        <TrendChart points={series} label="Visiteurs" />
      </div>

      {radios.length === 0 ? (
        <Empty label="Aucune radio dans le parc. Provisionne-en une ci-dessous." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Radio</th>
                <th scope="col">Statut</th>
                <th scope="col">Forfait</th>
                <th scope="col">Direct</th>
                <th scope="col">Jour</th>
                <th scope="col">Écoute</th>
                <th scope="col">Contenu</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {radios.map((r) => (
                <tr key={r.id} style={selectedId === r.id ? { outline: "1px solid var(--accent)" } : undefined}>
                  <td>
                    <HealthDot h={health[r.id]} />{" "}
                    <Link href={`/parc/${r.id}`} style={{ color: "var(--txt)", textDecoration: "underline" }}>
                      <strong>{r.name}</strong>
                    </Link>
                    <br />
                    <span style={{ color: "var(--txt-dim)", fontSize: 12 }}>
                      {r.slug}
                      {r.contactEmail ? ` · ${r.contactEmail}` : ""}
                    </span>
                  </td>
                  <td>
                    <span className={`status-dot ${r.status === "active" ? "status-published" : "status-archived"}`} />
                    {STATUS_LABEL[r.status]}
                  </td>
                  <td>
                    {r.plan || "—"}
                    <br />
                    <span style={{ color: "var(--txt-dim)", fontSize: 12 }}>{money(r.monthlyPrice)}</span>
                  </td>
                  <td>{r.live}</td>
                  <td>{r.today}</td>
                  <td>{formatDuration(r.listenSec)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.artists} anim. · {r.shows} ém.
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" type="button" onClick={() => selectRadio(r.id)} disabled={selectedId === r.id}>
                        {selectedId === r.id ? "Administrée" : "Administrer"}
                      </button>
                      {isOwner && (
                        <>
                          <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(r)}>
                            Éditer
                          </button>
                          {r.status !== "active" ? (
                            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirmStatus({ radio: r, status: "active" })}>
                              Activer
                            </button>
                          ) : (
                            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setConfirmStatus({ radio: r, status: "paused" })}>
                              Suspendre
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isOwner && (
        <>
          <h2 style={{ marginTop: 28 }}>Provisionner une nouvelle radio</h2>
          <p style={{ color: "var(--txt-dim)", fontSize: 13, marginTop: -6 }}>
            Crée le tenant (statut « en montage »). Le branchement du flux AzuraCast viendra automatiser le reste.
          </p>
          <form
            ref={formRef}
            onSubmit={createRadio}
            noValidate
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, maxWidth: 780 }}
          >
            <Field name="name" label="Nom *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required error={formErrors.name} />
            <Field name="slug" label="Slug (auto si vide)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} />
            <Field name="plan" label="Forfait" value={form.plan} onChange={(v) => setForm({ ...form, plan: v })} />
            <Field name="monthlyPrice" label="Prix ($/mois)" value={form.monthlyPrice} onChange={(v) => setForm({ ...form, monthlyPrice: v })} type="number" min="0" step="1" error={formErrors.monthlyPrice} />
            <Field name="domains" label="Domaines (séparés par ,)" value={form.domains} onChange={(v) => setForm({ ...form, domains: v })} />
            <Field name="streamUrl" label="Flux audio (stream URL)" value={form.streamUrl} onChange={(v) => setForm({ ...form, streamUrl: v })} type="url" error={formErrors.streamUrl} />
            <Field name="nowPlayingUrl" label="Now-playing URL" value={form.nowPlayingUrl} onChange={(v) => setForm({ ...form, nowPlayingUrl: v })} type="url" error={formErrors.nowPlayingUrl} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button className="btn" type="submit" disabled={creating || !form.name.trim()}>
                {creating ? "Création…" : "Créer la radio"}
              </button>
            </div>
          </form>
        </>
      )}

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

      {confirmStatus && (
        <Modal
          title={confirmStatus.status === "paused" ? "Suspendre la radio ?" : "Activer la radio ?"}
          onClose={() => setConfirmStatus(null)}
        >
          <p className="muted">
            {confirmStatus.status === "paused" ? (
              <>
                Suspendre <strong>{confirmStatus.radio.name}</strong> coupera la diffusion : les auditeurs en direct
                seront coupés et le site cessera de répondre.
              </>
            ) : (
              <>
                Réactiver <strong>{confirmStatus.radio.name}</strong> remettra la diffusion en ligne immédiatement.
              </>
            )}
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setConfirmStatus(null)}>
              Annuler
            </button>
            <button
              className={confirmStatus.status === "paused" ? "btn btn-danger" : "btn"}
              type="button"
              onClick={() => {
                const { radio, status } = confirmStatus;
                setConfirmStatus(null);
                void setStatus(radio, status);
              }}
            >
              {confirmStatus.status === "paused" ? "Suspendre" : "Activer"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─────────────── Panneau d'édition d'une radio (modal) ───────────────
   Exporté pour être réutilisé par la page détail (/parc/[id]). */
export function RadioEditPanel({
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
  const [errs, setErrs] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const [f, setF] = useState({
    name: radio.name,
    status: radio.status as RadioStatus,
    plan: radio.plan ?? "",
    monthlyPrice: radio.monthlyPrice != null ? String(radio.monthlyPrice) : "",
    domains: (radio.domains ?? []).join(", "),
    streamUrl: radio.streamUrl ?? "",
    nowPlayingUrl: radio.nowPlayingUrl ?? "",
    billingNote: radio.billingNote ?? "",
    contactName: radio.contactName ?? "",
    contactEmail: radio.contactEmail ?? "",
    contactPhone: radio.contactPhone ?? "",
    licenseConfirmed: radio.licenseConfirmed,
  });

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Le nom est requis.";
    if (f.monthlyPrice) {
      const n = Number(f.monthlyPrice);
      if (!Number.isFinite(n) || n < 0) e.monthlyPrice = "Prix invalide (doit être ≥ 0).";
    }
    const isUrl = (v: string) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    };
    if (f.streamUrl && !isUrl(f.streamUrl)) e.streamUrl = "URL invalide (ex. https://…).";
    if (f.nowPlayingUrl && !isUrl(f.nowPlayingUrl)) e.nowPlayingUrl = "URL invalide (ex. https://…).";
    return e;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    setErrs(v);
    if (Object.keys(v).length > 0) {
      const first = Object.keys(v)[0]!;
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
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
        contactName: f.contactName || null,
        contactEmail: f.contactEmail || null,
        contactPhone: f.contactPhone || null,
        licenseConfirmed: f.licenseConfirmed,
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
    <Modal title={`Éditer — ${radio.name}`} onClose={onClose}>
      <form
        ref={formRef}
        onSubmit={save}
        noValidate
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <Field name="name" label="Nom" value={f.name} onChange={(v) => setF({ ...f, name: v })} required error={errs.name} />
        <label style={{ display: "block", fontSize: 12, color: "var(--txt-dim)" }}>
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
        <Field name="plan" label="Forfait" value={f.plan} onChange={(v) => setF({ ...f, plan: v })} />
        <Field name="monthlyPrice" label="Prix ($/mois)" value={f.monthlyPrice} onChange={(v) => setF({ ...f, monthlyPrice: v })} type="number" min="0" step="1" error={errs.monthlyPrice} />
        <Field name="domains" label="Domaines (séparés par ,)" value={f.domains} onChange={(v) => setF({ ...f, domains: v })} wide />
        <Field name="streamUrl" label="Flux audio (stream URL)" value={f.streamUrl} onChange={(v) => setF({ ...f, streamUrl: v })} type="url" wide error={errs.streamUrl} />
        <Field name="nowPlayingUrl" label="Now-playing URL" value={f.nowPlayingUrl} onChange={(v) => setF({ ...f, nowPlayingUrl: v })} type="url" wide error={errs.nowPlayingUrl} />
        <Field name="contactName" label="Contact — nom" value={f.contactName} onChange={(v) => setF({ ...f, contactName: v })} />
        <Field name="contactEmail" label="Contact — courriel" value={f.contactEmail} onChange={(v) => setF({ ...f, contactEmail: v })} type="email" />
        <Field name="contactPhone" label="Contact — téléphone" value={f.contactPhone} onChange={(v) => setF({ ...f, contactPhone: v })} type="tel" />
        <label style={{ display: "block", fontSize: 12, color: "var(--txt-dim)", gridColumn: "1 / -1" }}>
          Note de facturation
          <textarea
            value={f.billingNote}
            onChange={(e) => setF({ ...f, billingNote: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1 / -1", fontSize: 13, color: "var(--txt)" }}>
          <input
            type="checkbox"
            checked={f.licenseConfirmed}
            onChange={(e) => setF({ ...f, licenseConfirmed: e.target.checked })}
          />
          Licences SOCAN / Re:Sound reçues
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
    </Modal>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--txt)",
  border: "1px solid var(--line-2)",
};

const alertBox: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: 14,
  marginBottom: 18,
  fontSize: 14,
};

/* Centre d'alertes opérateur : ce qui demande l'attention de l'owner, tout le
   parc d'un coup (flux down, licences manquantes, montage, suspension). */
function AlertsPanel({ radios, health }: { radios: RadioSummary[]; health: Record<string, RadioHealth> }) {
  const alerts: { id: string; name: string; high: boolean; msg: string }[] = [];
  for (const r of radios) {
    if (r.status === "active" && health[r.id]?.status === "down")
      alerts.push({ id: r.id, name: r.name, high: true, msg: "Flux injoignable" });
    if (r.status === "active" && r.healthStatus === "silent")
      alerts.push({ id: r.id, name: r.name, high: true, msg: "Silence détecté (dead-air)" });
    if (r.status === "active" && !r.licenseConfirmed)
      alerts.push({ id: r.id, name: r.name, high: true, msg: "Licences SOCAN / Re:Sound non confirmées" });
    if (r.status === "provisioning")
      alerts.push({ id: r.id, name: r.name, high: false, msg: "En montage — à finaliser" });
    if (r.status === "paused") alerts.push({ id: r.id, name: r.name, high: false, msg: "Radio suspendue" });
  }
  if (!alerts.length)
    return (
      <div style={{ ...alertBox, borderColor: "var(--ok)" }} role="status">
        <span aria-hidden="true">✅</span> Tout est en ordre — rien à traiter.
      </div>
    );
  return (
    <div style={{ ...alertBox, borderColor: "var(--warn)" }} role="alert">
      <strong>
        <span aria-hidden="true">⚠️</span> À traiter ({alerts.length})
      </strong>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {alerts.map((a, i) => (
          <Link
            key={i}
            href={`/parc/${a.id}`}
            style={{ color: "var(--txt)", textDecoration: "none", display: "flex", gap: 8, alignItems: "center" }}
          >
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: "50%", background: a.high ? "var(--danger)" : "var(--warn)", display: "inline-block" }}
            />
            {/* Sévérité non portée par la seule couleur du point. */}
            <span className="sr-only">{a.high ? "Priorité haute :" : "À surveiller :"}</span>
            <strong>{a.name}</strong>
            <span style={{ color: "var(--txt-dim)" }}>— {a.msg}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function HealthDot({ h }: { h?: RadioHealth }) {
  const map = {
    up: ["var(--ok)", "Flux en ligne"],
    down: ["var(--danger)", "Flux injoignable"],
    none: ["var(--txt-faint)", "Pas de flux configuré"],
  } as const;
  const [color, title] = map[h?.status ?? "none"];
  const label = h?.ms != null ? `${title} (${h.ms} ms)` : title;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: color }}
    />
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: "var(--panel)",
        border: `1px solid ${accent ? "var(--accent)" : "var(--line)"}`,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--txt-dim)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--txt-faint)" }}>{sub}</div>}
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
  name,
  error,
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  wide?: boolean;
  name?: string;
  error?: string;
  min?: string;
  step?: string;
}) {
  const errId = useId();
  const invalid = Boolean(error);
  return (
    <label style={{ display: "block", fontSize: 12, color: "var(--txt-dim)", gridColumn: wide ? "1 / -1" : undefined }}>
      {label}
      <input
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        min={min}
        step={step}
        aria-invalid={invalid}
        aria-describedby={invalid ? errId : undefined}
        style={invalid ? { ...inputStyle, borderColor: "var(--danger)" } : inputStyle}
      />
      {error && (
        <span id={errId} role="alert" style={{ display: "block", marginTop: 4, fontSize: 12, color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </label>
  );
}
