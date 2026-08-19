"use client";

import { useState } from "react";
import { CrudPage, type FieldConfig, type Column } from "@/components/crud";
import { AudioUpload } from "@/components/audio-upload";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMediaAssets } from "@/lib/hooks";
import {
  isEditorialAdmin,
  formatDuration,
  minToHHMM,
  hhmmToMin,
  type MediaAsset,
  type AdRotation,
} from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "published", label: "Publié" },
  { value: "archived", label: "Archivé" },
];

const KIND_OPTIONS = [
  { value: "jingle", label: "Jingle" },
  { value: "ad", label: "Pub" },
  { value: "intro", label: "Intro" },
  { value: "outro", label: "Outro" },
  { value: "bed", label: "Tapis (bed)" },
];

const DAY_OPTIONS = [
  { value: "-1", label: "Tous les jours" },
  { value: "0", label: "Dimanche" },
  { value: "1", label: "Lundi" },
  { value: "2", label: "Mardi" },
  { value: "3", label: "Mercredi" },
  { value: "4", label: "Jeudi" },
  { value: "5", label: "Vendredi" },
  { value: "6", label: "Samedi" },
];

const kindLabel = (k: MediaAsset["kind"]) => KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;

const mediaColumns: Column<MediaAsset>[] = [
  { key: "name", label: "Nom" },
  { key: "kind", label: "Type", render: (r) => kindLabel(r.kind) },
  {
    key: "durationSec",
    label: "Durée",
    render: (r) => (r.durationSec ? formatDuration(r.durationSec) : "—"),
  },
  {
    key: "audioUrl",
    label: "Audio",
    render: (r) => (r.audioUrl ? "prêt" : <span className="muted">à téléverser</span>),
  },
  {
    key: "status",
    label: "Statut",
    render: (r) => (
      <span>
        <span className={`status-dot status-${r.status}`} />
        {STATUS_OPTIONS.find((s) => s.value === r.status)?.label}
      </span>
    ),
  },
];

const mediaFields: FieldConfig[] = [
  { name: "name", label: "Nom", type: "text", required: true, half: true },
  { name: "kind", label: "Type", type: "select", half: true, options: KIND_OPTIONS, default: "jingle" },
  { name: "status", label: "Statut", type: "select", half: true, options: STATUS_OPTIONS, default: "draft" },
];

interface SyncResult {
  synced: number;
  errors: { rotationId: string; assetName: string; error?: string }[];
  skippedNoAudio: string[];
}

export default function MediasPage() {
  const { user } = useAuth();
  const toast = useToast();
  // Même règle que les pistes : pas d'ownership par artiste, tout éditorial de la
  // radio (animateur/superadmin/owner) peut gérer. `it` est exclu.
  const canManage = user?.role === "animateur" || isEditorialAdmin(user?.role);
  // Pousser vers le moteur de diffusion = superadmin/owner seulement (comme l'API).
  const canSync = isEditorialAdmin(user?.role);
  const [syncing, setSyncing] = useState(false);

  const doSync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<SyncResult>("/v1/admin/rotations/sync", {});
      const parts = [`${r.synced} rotation${r.synced > 1 ? "s" : ""} synchronisée${r.synced > 1 ? "s" : ""}`];
      if (r.errors.length) parts.push(`${r.errors.length} en erreur (${r.errors[0]?.error ?? "?"})`);
      if (r.skippedNoAudio.length) parts.push(`sans audio : ${r.skippedNoAudio.join(", ")}`);
      toast(parts.join(" · "), r.errors.length ? "warn" : "ok");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Échec de la synchronisation", "error");
    } finally {
      setSyncing(false);
    }
  };

  const { data: assets } = useMediaAssets();
  const assetName = (id: string | null) => assets?.find((a) => a.id === id)?.name ?? "—";

  const rotationColumns: Column<AdRotation>[] = [
    { key: "assetId", label: "Média", render: (r) => assetName(r.assetId) },
    {
      key: "dayOfWeek",
      label: "Fenêtre",
      render: (r) =>
        `${DAY_OPTIONS.find((d) => Number(d.value) === r.dayOfWeek)?.label ?? r.dayOfWeek} · ${minToHHMM(r.startMin)}–${minToHHMM(r.endMin)}`,
    },
    { key: "weight", label: "Poids" },
    {
      key: "isActive",
      label: "Active",
      render: (r) => (r.isActive ? "oui" : <span className="muted">non</span>),
    },
  ];

  const rotationFields: FieldConfig[] = [
    {
      name: "assetId",
      label: "Média",
      type: "select",
      required: true,
      options: (assets ?? []).map((a) => ({ value: a.id, label: `${a.name} (${kindLabel(a.kind)})` })),
    },
    { name: "dayOfWeek", label: "Jour", type: "select", half: true, options: DAY_OPTIONS, default: "-1" },
    { name: "weight", label: "Poids (1-100)", type: "number", half: true, default: 1 },
    { name: "from", label: "Début (HH:MM)", type: "text", half: true, default: "00:00", hint: "ex : 06:00" },
    { name: "to", label: "Fin (HH:MM)", type: "text", half: true, default: "24:00", hint: "24:00 = minuit" },
    { name: "isActive", label: "Active", type: "checkbox", default: true },
  ];

  return (
    <div>
      <CrudPage<MediaAsset>
        title="Médias (jingles, pubs, habillage)"
        endpoint="/v1/admin/media"
        columns={mediaColumns}
        fields={mediaFields}
        canCreate={canManage}
        canEdit={() => canManage}
        canDelete={() => canManage}
        rowLabel={(r) => r.name}
        extraActions={(r, reload) =>
          canManage ? (
            <AudioUpload kind="media" targetId={r.id} hasAudio={!!r.audioUrl} onDone={reload} />
          ) : null
        }
        toForm={(r) => ({ name: r.name, kind: r.kind, status: r.status })}
      />
      {canSync && (
        <div className="page-head">
          <p className="muted" style={{ margin: 0 }}>
            Le plan ci-dessous ne diffuse rien tant qu&apos;il n&apos;est pas poussé vers le moteur
            de diffusion. Seules les rotations actives dont le média est publié et téléversé
            partent.
          </p>
          <button className="btn btn-primary" onClick={() => void doSync()} disabled={syncing}>
            {syncing ? "Synchronisation…" : "Synchroniser la diffusion"}
          </button>
        </div>
      )}
      <CrudPage<AdRotation>
        title="Rotations (plan de diffusion)"
        endpoint="/v1/admin/rotations"
        columns={rotationColumns}
        fields={rotationFields}
        canCreate={canManage}
        canEdit={() => canManage}
        canDelete={() => canManage}
        rowLabel={(r) => `${assetName(r.assetId)} · ${minToHHMM(r.startMin)}–${minToHHMM(r.endMin)}`}
        toForm={(r) => ({
          assetId: r.assetId ?? "",
          dayOfWeek: String(r.dayOfWeek),
          weight: r.weight,
          from: minToHHMM(r.startMin),
          to: minToHHMM(r.endMin),
          isActive: r.isActive,
        })}
        transformPayload={(payload, values) => {
          const startMin = hhmmToMin(String(values.from ?? ""));
          const endMin = hhmmToMin(String(values.to ?? ""));
          if (startMin == null || endMin == null) throw new Error("Heures invalides (format HH:MM)");
          if (startMin >= endMin) throw new Error("L'heure de fin doit suivre le début");
          delete payload.from;
          delete payload.to;
          return { ...payload, dayOfWeek: Number(values.dayOfWeek ?? -1), startMin, endMin };
        }}
      />
    </div>
  );
}
