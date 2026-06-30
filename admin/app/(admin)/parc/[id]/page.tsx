"use client";

/* Page détail d'UNE radio (console opérateur owner) : dashboard complet —
   KPIs, courbe de visiteurs, checklist d'onboarding, fiche contact, actions.
   Accès via le Parc (clic sur le nom d'une radio). */

import { useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { useRadioDetail, useDistribution } from "@/lib/hooks";
import { Empty, Spinner, ErrorState } from "@/components/ui";
import { TrendChart } from "@/components/trend-chart";
import { formatDuration, isCrossRadio, type RadioStatus } from "@/lib/types";
import { RadioEditPanel } from "../page";

const STATUS_LABEL: Record<RadioStatus, string> = { active: "Active", provisioning: "En montage", paused: "Suspendue" };

export default function RadioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { selectedId, selectRadio } = useRadio();
  const [editing, setEditing] = useState(false);

  const crossRadio = isCrossRadio(user?.role);
  const isOwner = user?.role === "owner";

  // Détail d'une radio, NON radio-scopé (console owner). `radioId` figure dans
  // la clé → re-fetch auto quand on change de radio cible ; `enabled = crossRadio`
  // évite un fetch (et un 403) pour les non-cross-radio. `radio` vaut `undefined`
  // (chargement) puis `null` (introuvable) ou la radio.
  const { radio, health, series, error, reload } = useRadioDetail(id, crossRadio);
  const loadError = error ? (error as ApiError).message || "Impossible de charger la radio." : null;

  if (!crossRadio) return <Empty label="Réservé à l'opérateur (En Ondes) et à l'équipe IT." />;
  if (loadError) return <ErrorState message={loadError} onRetry={reload} />;
  if (radio === undefined) return <Spinner />;
  if (radio === null) return <Empty label="Radio introuvable." />;

  const items = [
    { label: "Flux audio (stream)", done: !!radio.streamUrl },
    { label: "Now-playing", done: !!radio.nowPlayingUrl },
    { label: "Domaine", done: (radio.domains?.length ?? 0) > 0 },
    { label: "Contact client", done: !!radio.contactEmail },
    { label: "Forfait + prix", done: !!radio.plan || (radio.monthlyPrice ?? 0) > 0 },
    { label: "Licences SOCAN / Re:Sound", done: radio.licenseConfirmed },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  const hColor = health?.status === "up" ? "var(--ok)" : health?.status === "down" ? "var(--danger)" : "var(--txt-faint)";
  const hLabel = health?.status === "up" ? "Flux en ligne" : health?.status === "down" ? "Flux injoignable" : "Pas de flux configuré";

  return (
    <div>
      <div className="page-head" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/parc" style={{ color: "var(--txt-dim)", textDecoration: "none" }}>
          <span aria-hidden="true">←</span> Parc
        </Link>
        <h1 style={{ margin: 0 }}>
          <span role="img" aria-label={hLabel} title={hLabel} style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: hColor, marginRight: 8 }} />
          {radio.name}
        </h1>
        <span className={`status-dot ${radio.status === "active" ? "status-published" : "status-archived"}`} aria-hidden="true" />
        <span style={{ color: "var(--txt-dim)" }}>{STATUS_LABEL[radio.status]}</span>
        <div className="row-actions" style={{ marginLeft: "auto" }}>
          {isOwner && (
            <button className="btn btn-sm" type="button" onClick={() => setEditing(true)}>
              Éditer cette radio
            </button>
          )}
          <button className="btn btn-sm" type="button" onClick={() => selectRadio(radio.id)} disabled={selectedId === radio.id}>
            {selectedId === radio.id ? "Administrée" : "Administrer cette radio"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Kpi label="En direct" value={radio.live} />
        <Kpi label="Aujourd'hui" value={radio.today} />
        <Kpi label="Visiteurs (total)" value={radio.sessions} />
        <Kpi label="Écoute cumulée" value={formatDuration(radio.listenSec)} />
        <Kpi label="Prix" value={radio.monthlyPrice ? `${radio.monthlyPrice} $/mois` : "—"} />
        <Kpi label="Contenu" value={`${radio.artists} / ${radio.shows}`} sub="anim. / émissions" />
      </div>

      <div style={cardStyle}>
        <strong>Visiteurs — 30 derniers jours</strong>
        <div style={{ marginTop: 8 }}>
          <TrendChart points={series} label="Visiteurs" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <strong>Mise en route</strong>
            <span style={{ color: pct === 100 ? "var(--ok)" : "var(--txt-dim)" }}>{pct}%</span>
          </div>
          <div
            style={{ height: 8, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden", marginBottom: 12 }}
            role="img"
            aria-label={`Mise en route : ${pct}%`}
          >
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "var(--ok)" : "var(--accent)" }} />
          </div>
          {items.map((it) => (
            <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <span aria-hidden="true" style={{ color: it.done ? "var(--ok)" : "var(--txt-faint)" }}>{it.done ? "✓" : "○"}</span>
              {/* Statut non porté par la seule couleur/glyphe. */}
              <span className="sr-only">{it.done ? "Fait :" : "À faire :"}</span>
              <span style={{ color: it.done ? "var(--txt)" : "var(--txt-dim)" }}>{it.label}</span>
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <strong>Contact client</strong>
          <Row label="Nom" value={radio.contactName} />
          <Row label="Courriel" value={radio.contactEmail} />
          <Row label="Téléphone" value={radio.contactPhone} />
          <Row label="Forfait" value={radio.plan} />
          <Row label="Domaines" value={(radio.domains ?? []).join(", ") || null} />
          <Row label="Flux" value={radio.streamUrl} />
          <Row label="Note" value={radio.billingNote} />
          {isOwner && (
            <p style={{ color: "var(--txt-faint)", fontSize: 12, marginTop: 10 }}>
              Modifier ces infos : utilise le bouton{" "}
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                onClick={() => setEditing(true)}
                style={{ verticalAlign: "baseline" }}
              >
                Éditer cette radio
              </button>{" "}
              en haut de la page.
            </p>
          )}
        </div>
      </div>

      <DistributionCard id={id} />

      {editing && radio && (
        <RadioEditPanel
          radio={radio}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: 16,
};

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: "var(--txt-dim)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--txt-faint)" }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line)", fontSize: 13 }}>
      <span style={{ color: "var(--txt-dim)", width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: value ? "var(--txt)" : "var(--txt-faint)", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
}

/* Carte « Distribution » : colis de métadonnées copiable (TuneIn, Radio Garden,
   Alexa, podcasts) + checklist d'inscription persistée dans radios.distribution.
   Console owner/it (le hook pointe vers /v1/owner/...). */
function DistributionCard({ id }: { id: string }) {
  const { data, error, save } = useDistribution(id);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (error) {
    return (
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <strong>Distribution &amp; inscriptions</strong>
        <p style={{ color: "var(--txt-faint)", fontSize: 13, marginTop: 8 }}>
          Impossible de charger le colis de distribution.
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <strong>Distribution &amp; inscriptions</strong>
        <div style={{ marginTop: 10 }}>
          <Spinner />
        </div>
      </div>
    );
  }

  const pkg = data.package;
  const doneCount = data.checklist.filter((c) => c.done).length;

  const toggle = async (key: string, done: boolean) => {
    const next: Record<string, boolean> = {};
    for (const ch of data.checklist) next[ch.key] = ch.done;
    next[key] = done;
    setSavingKey(key);
    try {
      await save(next);
    } finally {
      setSavingKey(null);
    }
  };

  const copyAll = [
    `Nom : ${pkg.name}`,
    `Slug : ${pkg.slug}`,
    pkg.streamUrl ? `Flux audio : ${pkg.streamUrl}` : null,
    pkg.nowPlayingUrl ? `Now-playing : ${pkg.nowPlayingUrl}` : null,
    `Domaines : ${(pkg.domains ?? []).join(", ") || "—"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div style={{ ...cardStyle, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>Distribution &amp; inscriptions</strong>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void navigator.clipboard?.writeText(copyAll)}>
          Copier le colis
        </button>
      </div>
      <p style={{ color: "var(--txt-dim)", fontSize: 12, marginTop: 0, marginBottom: 10 }}>
        Métadonnées à fournir à TuneIn, Radio Garden, au skill Alexa et aux plateformes de podcasts.
      </p>
      <CopyRow label="Nom" value={pkg.name} />
      <CopyRow label="Slug" value={pkg.slug} />
      <CopyRow label="Flux audio" value={pkg.streamUrl} />
      <CopyRow label="Now-playing" value={pkg.nowPlayingUrl} />
      <CopyRow label="Domaines" value={(pkg.domains ?? []).join(", ") || null} />

      <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>Inscriptions</strong>
        <span style={{ color: "var(--txt-dim)", fontSize: 12 }}>
          {doneCount}/{data.checklist.length}
        </span>
      </div>
      {data.checklist.map((ch) => (
        <label
          key={ch.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
            borderTop: "1px solid var(--line)",
            fontSize: 13,
            cursor: savingKey ? "wait" : "pointer",
          }}
        >
          <input type="checkbox" checked={ch.done} disabled={!!savingKey} onChange={(e) => void toggle(ch.key, e.target.checked)} />
          <span style={{ color: ch.done ? "var(--txt)" : "var(--txt-dim)" }}>{ch.label}</span>
          {savingKey === ch.key && <span style={{ color: "var(--txt-faint)", fontSize: 11 }}>…</span>}
        </label>
      ))}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponible (contexte non sécurisé) — ignore. */
    }
  };
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line)", fontSize: 13, alignItems: "center" }}>
      <span style={{ color: "var(--txt-dim)", width: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: value ? "var(--txt)" : "var(--txt-faint)", wordBreak: "break-all", flex: 1 }}>{value || "—"}</span>
      {value && (
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void copy()} style={{ flexShrink: 0 }}>
          {copied ? "Copié" : "Copier"}
        </button>
      )}
    </div>
  );
}
