"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSchedule, useArtists } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Modal, Field, Spinner, ConfirmDelete, Empty, ErrorState } from "@/components/ui";
import {
  SLOT_TAGS,
  DAY_NAMES,
  tagColor,
  minToHHMM,
  hhmmToMin,
  isEditorialAdmin,
  type ScheduleSlot,
  type SlotTag,
} from "@/lib/types";

// Ordre d'affichage : lundi → dimanche
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface SlotForm {
  from: string;
  to: string;
  title: string;
  hostLabel: string;
  tag: SlotTag;
  artistId: string;
  isLive: boolean;
}

const EMPTY_FORM: SlotForm = {
  from: "",
  to: "",
  title: "",
  hostLabel: "",
  tag: "hitlist",
  artistId: "",
  isLive: false,
};

export default function GrillePage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = isEditorialAdmin(user?.role);

  const [day, setDay] = useState(1);
  const [editing, setEditing] = useState<ScheduleSlot | "new" | null>(null);
  const [form, setForm] = useState<SlotForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ScheduleSlot | null>(null);

  // Grille + animateurs via le cache SWR (clés radio-scopées). keepPreviousData
  // garde la grille de la radio précédente pendant le fetch de la nouvelle.
  const schedule = useSchedule();
  const artistsRes = useArtists();
  const slots = schedule.data;
  const artists = artistsRes.data ?? [];
  const fetchError = schedule.error || artistsRes.error;
  const error = fetchError ? (fetchError as ApiError).message : null;
  // Toast sur l'apparition d'une erreur de chargement (transition null → msg).
  const prevErrRef = useRef<string | null>(null);
  useEffect(() => {
    if (error && error !== prevErrRef.current) toast(error, "error");
    prevErrRef.current = error;
  }, [error, toast]);
  const reload = () => Promise.all([schedule.mutate(), artistsRes.mutate()]);

  const daySlots = useMemo(
    () => (slots ?? []).filter((s) => s.dayOfWeek === day).sort((a, b) => a.startMin - b.startMin),
    [slots, day],
  );

  const owns = (s: ScheduleSlot) =>
    isAdmin || (user?.role === "animateur" && user?.artistId != null && s.artistId === user.artistId);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditing("new");
  };
  const openEdit = (s: ScheduleSlot) => {
    setForm({
      from: minToHHMM(s.startMin),
      to: minToHHMM(s.endMin),
      title: s.title,
      hostLabel: s.hostLabel,
      tag: s.tag,
      artistId: s.artistId ?? "",
      isLive: s.isLive,
    });
    setEditing(s);
  };

  const save = async () => {
    const startMin = hhmmToMin(form.from);
    const endMin = form.to === "24:00" ? 1440 : hhmmToMin(form.to);
    if (startMin == null || endMin == null) return toast("Heures invalides (format HH:MM)", "warn");
    if (startMin >= endMin) return toast("L'heure de fin doit suivre le début", "warn");
    if (!form.title.trim() || !form.hostLabel.trim()) return toast("Titre et animateur requis", "warn");

    const payload = {
      dayOfWeek: day,
      startMin,
      endMin,
      title: form.title.trim(),
      hostLabel: form.hostLabel.trim(),
      tag: form.tag,
      artistId: form.artistId || null,
      isLive: form.isLive,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        await api.post("/v1/admin/schedule-slots", payload);
        toast("Créneau ajouté ✓", "ok");
      } else if (editing) {
        await api.patch(`/v1/admin/schedule-slots/${editing.id}`, payload);
        toast("Créneau modifié ✓", "ok");
      }
      setEditing(null);
      await schedule.mutate();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/v1/admin/schedule-slots/${deleting.id}`);
      toast("Créneau supprimé", "ok");
      setDeleting(null);
      await schedule.mutate();
    } catch (e) {
      toast((e as ApiError).message, "error");
      setDeleting(null);
    }
  };

  // Détection de trous / chevauchements pour aider l'éditeur.
  const coverageWarning = useMemo(() => {
    // Jour vide : l'état <Empty> ci-dessous porte déjà le message.
    if (daySlots.length === 0) return null;
    const issues: string[] = [];
    if (daySlots[0]!.startMin !== 0) issues.push("ne commence pas à 00:00");
    for (let i = 1; i < daySlots.length; i++) {
      if (daySlots[i]!.startMin !== daySlots[i - 1]!.endMin) {
        issues.push(`trou/chevauchement à ${minToHHMM(daySlots[i]!.startMin)}`);
      }
    }
    if (daySlots[daySlots.length - 1]!.endMin !== 1440) issues.push("ne finit pas à 24:00");
    return issues.length ? issues.join(" · ") : null;
  }, [daySlots]);

  return (
    <div>
      <div className="page-head">
        <h1>Grille horaire</h1>
        {(isAdmin || user?.role === "animateur") && (
          <button className="btn btn-primary" onClick={openNew}>
            + Créneau
          </button>
        )}
      </div>

      <div className="day-tabs">
        {DAY_ORDER.map((d) => (
          <button key={d} className={`day-tab ${d === day ? "active" : ""}`} onClick={() => setDay(d)}>
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>

      {coverageWarning && (
        <p className="muted" role="status" style={{ marginBottom: 14, color: "var(--warn)" }}>
          <span aria-hidden="true">⚠ </span>
          Couverture incomplète : {coverageWarning}
        </p>
      )}

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !slots ? (
        <Spinner />
      ) : daySlots.length === 0 ? (
        <Empty label="Aucun créneau ce jour." />
      ) : (
        <div className="slot-list">
          {daySlots.map((s) => (
            <div key={s.id} className="slot-row" style={{ borderLeftColor: tagColor(s.tag) }}>
              <span className="slot-time">
                {minToHHMM(s.startMin)}–{s.endMin === 1440 ? "24:00" : minToHHMM(s.endMin)}
              </span>
              <span className="slot-title">
                {s.title} {s.isLive && <span className="tag" style={{ background: "var(--accent)", marginLeft: 6 }}>LIVE</span>}
              </span>
              <span className="slot-host">{s.hostLabel}</span>
              <div className="row-actions">
                {owns(s) && (
                  <button className="btn btn-sm btn-ghost" onClick={() => openEdit(s)}>
                    Éditer
                  </button>
                )}
                {owns(s) && (
                  <button className="btn btn-sm btn-danger" onClick={() => setDeleting(s)}>
                    Suppr.
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={`${editing === "new" ? "Nouveau créneau" : "Éditer le créneau"} — ${DAY_NAMES[day]}`}
          onClose={() => setEditing(null)}
        >
          <div className="field-row">
            <Field label="Début (HH:MM)" hint="ex : 16:00">
              <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="16:00" />
            </Field>
            <Field label="Fin (HH:MM)" hint="24:00 = minuit">
              <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="18:00" />
            </Field>
          </div>
          <Field label="Titre de l'émission">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <div className="field-row">
            <Field label="Animateur (libellé affiché)">
              <input value={form.hostLabel} onChange={(e) => setForm({ ...form, hostLabel: e.target.value })} placeholder="Alain Perron" />
            </Field>
            <Field label="Tag / couleur">
              <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value as SlotTag })}>
                {SLOT_TAGS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Lier à une fiche animateur (optionnel)">
            <select value={form.artistId} onChange={(e) => setForm({ ...form, artistId: e.target.value })}>
              <option value="">— aucun —</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <div className="checkbox">
              <input
                type="checkbox"
                id="isLive"
                checked={form.isLive}
                onChange={(e) => setForm({ ...form, isLive: e.target.checked })}
              />
              <label htmlFor="isLive" style={{ margin: 0 }}>
                Émission en direct (live)
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>
              Annuler
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDelete
          what={`${deleting.title} (${minToHHMM(deleting.startMin)})`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
