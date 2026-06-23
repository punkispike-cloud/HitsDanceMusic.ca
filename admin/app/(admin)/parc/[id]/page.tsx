"use client";

/* Page détail d'UNE radio (console opérateur owner) : dashboard complet —
   KPIs, courbe de visiteurs, checklist d'onboarding, fiche contact, actions.
   Accès via le Parc (clic sur le nom d'une radio). */

import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { Spinner, Empty } from "@/components/ui";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { formatDuration, type RadioSummary, type RadioHealth, type OwnerTimeseriesPoint, type RadioStatus } from "@/lib/types";

const STATUS_LABEL: Record<RadioStatus, string> = { active: "Active", provisioning: "En montage", paused: "Suspendue" };

export default function RadioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { selectedId, selectRadio } = useRadio();
  const [radio, setRadio] = useState<RadioSummary | null | undefined>(undefined);
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [health, setHealth] = useState<RadioHealth | null>(null);

  const isOwner = user?.role === "owner";

  useEffect(() => {
    if (!isOwner) return;
    api
      .get<RadioSummary[]>("/v1/owner/radios")
      .then((rows) => setRadio(rows.find((r) => r.id === id) ?? null))
      .catch(() => setRadio(null));
    api
      .get<OwnerTimeseriesPoint[]>(`/v1/owner/timeseries?days=30&radio=${id}`)
      .then((rows) => setSeries(rows.map((r) => ({ day: r.day, value: r.sessions }))))
      .catch(() => setSeries([]));
    api
      .get<RadioHealth[]>("/v1/owner/health")
      .then((h) => setHealth(h.find((x) => x.id === id) ?? null))
      .catch(() => setHealth(null));
  }, [isOwner, id]);

  if (!isOwner) return <Empty label="Réservé à l'opérateur (En Ondes)." />;
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
  const hColor = health?.status === "up" ? "#2ecc71" : health?.status === "down" ? "#e74c3c" : "#778";

  return (
    <div>
      <div className="page-head" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/parc" style={{ color: "#9aa", textDecoration: "none" }}>
          ← Parc
        </Link>
        <h1 style={{ margin: 0 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: hColor, marginRight: 8 }} />
          {radio.name}
        </h1>
        <span className={`status-dot ${radio.status === "active" ? "status-published" : "status-archived"}`} />
        <span style={{ color: "#9aa" }}>{STATUS_LABEL[radio.status]}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
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
          <TrendChart points={series} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <strong>Mise en route</strong>
            <span style={{ color: pct === 100 ? "#2ecc71" : "#9aa" }}>{pct}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "#23232b", overflow: "hidden", marginBottom: 12 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#2ecc71" : "var(--accent, #3aa0ff)" }} />
          </div>
          {items.map((it) => (
            <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
              <span style={{ color: it.done ? "#2ecc71" : "#667" }}>{it.done ? "✓" : "○"}</span>
              <span style={{ color: it.done ? "var(--txt, #eee)" : "#9aa" }}>{it.label}</span>
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
          <p style={{ color: "#778", fontSize: 12, marginTop: 10 }}>
            Modifier ces infos : retourne au <Link href="/parc" style={{ color: "var(--accent, #3aa0ff)" }}>Parc</Link> → bouton « Éditer ».
          </p>
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--panel, #15151b)",
  border: "1px solid var(--border, #2a2a33)",
  borderRadius: 10,
  padding: 16,
};

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: "#9aa" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#778" }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: "1px solid #23232b", fontSize: 13 }}>
      <span style={{ color: "#9aa", width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: value ? "var(--txt, #eee)" : "#667", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
}
