"use client";

/* Sondages en direct : l'animateur pose une question à l'antenne, les auditeurs
   votent depuis le site public (POST /v1/polls/:id/vote). Accès (lecture incluse)
   = animateur + superadmin/owner — `it` et `lecteur` exclus (résultats agrégés
   de votes d'auditeurs, audit 2026-08-16 G5). Les résultats se rafraîchissent
   toutes les 5 s (temps-réel). Les mutations sont tracées par auditMiddleware
   (entity = "polls"). */

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePolls, usePollResults, useShows } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Empty, Forbidden, ErrorState, TableSkeleton, Modal, Field, Spinner } from "@/components/ui";
import { isEditorialAdmin, type Poll } from "@/lib/types";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

/* Dépouillement en direct d'un sondage : barres proportionnelles + compteurs.
   `live` false (sondage fermé) → pas de re-polling (résultat figé). */
function LiveResults({ pollId, live }: { pollId: string; live: boolean }) {
  const { data, error } = usePollResults(pollId, live ? {} : { refreshInterval: 0 });
  if (error) return <div className="muted" style={{ fontSize: "0.8rem" }}>Résultats indisponibles.</div>;
  if (!data) return <Spinner label="Résultats…" />;
  const max = Math.max(1, ...data.results.map((r) => r.count));
  return (
    <div>
      <div aria-hidden="true">
        {data.results.map((r) => (
          <div key={r.optionIndex} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ width: 170, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>
              {r.label}
            </span>
            <span style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}>
              <span style={{ display: "block", width: `${(r.count / max) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4, minWidth: r.count ? 3 : 0 }} />
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", width: 70, textAlign: "right", fontSize: "0.85rem" }}>
              {r.count}
              {data.totalVotes ? <span className="muted"> · {Math.round((r.count / data.totalVotes) * 100)}%</span> : ""}
            </span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>
        {data.totalVotes} vote{data.totalVotes > 1 ? "s" : ""}
        {live ? " · en direct (5 s)" : ""}
      </div>
      {/* Alternative tabulaire réservée aux lecteurs d'écran. */}
      <table className="sr-only">
        <caption>Résultats du sondage</caption>
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Votes</th>
            <th scope="col">Part</th>
          </tr>
        </thead>
        <tbody>
          {data.results.map((r) => (
            <tr key={r.optionIndex}>
              <th scope="row">{r.label}</th>
              <td>{r.count}</td>
              <td>{data.totalVotes ? `${Math.round((r.count / data.totalVotes) * 100)} %` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreatePollModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const { data: shows } = useShows();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [showId, setShowId] = useState("");
  const [busy, setBusy] = useState(false);

  const setOption = (i: number, v: string) => setOptions((opts) => opts.map((o, k) => (k === i ? v : o)));
  const addOption = () => setOptions((opts) => (opts.length < MAX_OPTIONS ? [...opts, ""] : opts));
  const removeOption = (i: number) => setOptions((opts) => (opts.length > MIN_OPTIONS ? opts.filter((_, k) => k !== i) : opts));

  const submit = async () => {
    const q = question.trim();
    const cleanOpts = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!q) { toast("Pose une question", "warn"); return; }
    if (cleanOpts.length < MIN_OPTIONS) { toast(`Au moins ${MIN_OPTIONS} options`, "warn"); return; }
    if (cleanOpts.length > MAX_OPTIONS) { toast(`Maximum ${MAX_OPTIONS} options`, "warn"); return; }
    setBusy(true);
    try {
      await api.post<Poll>("/v1/admin/polls", {
        question: q,
        options: cleanOpts,
        showId: showId || null,
      });
      toast("Sondage lancé ✓", "ok");
      onCreated();
      onClose();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nouveau sondage" onClose={onClose}>
      <Field label="Question" hint="Courte et claire, posée à l'antenne.">
        <input
          type="text"
          value={question}
          maxLength={280}
          placeholder="Quel titre pour le prochain direct ?"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </Field>

      <div className="field">
        <label>Réponses (2 à 6)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {options.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={o}
                maxLength={120}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOption(i, e.target.value)}
              />
              {options.length > MIN_OPTIONS && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeOption(i)} aria-label={`Retirer l'option ${i + 1}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={addOption}>
            + Ajouter une option
          </button>
        )}
      </div>

      <Field label="Émission (optionnel)" hint="Lie le sondage à l'émission en cours.">
        <select value={showId} onChange={(e) => setShowId(e.target.value)}>
          <option value="">— Aucune —</option>
          {(shows ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </Field>

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? "Lancement…" : "Lancer le sondage"}
        </button>
      </div>
    </Modal>
  );
}

export default function SondagesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error } = usePolls();
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);

  const canManage = user?.role === "animateur" || isEditorialAdmin(user?.role);
  const loadError = error ? "Impossible de charger les sondages." : null;

  // `it` (technique) et `lecteur` n'ont pas accès aux sondages : les résultats
  // agrègent des votes d'auditeurs (G5).
  if (user?.role === "it" || user?.role === "lecteur") {
    return (
      <div>
        <div className="page-head">
          <h1>Sondages</h1>
        </div>
        <Forbidden
          label="Réservé aux animateurs et gestionnaires."
          hint="Les sondages en direct agrègent des votes d'auditeurs : accès limité à l'antenne et à la gestion."
        />
      </div>
    );
  }

  // Revalide la liste + tous les dépouillements (clés /v1/admin/polls…).
  const reloadPolls = () =>
    globalMutate((key) => Array.isArray(key) && typeof key[0] === "string" && key[0].startsWith("/v1/admin/polls"));

  const closePoll = async (id: string) => {
    setClosing(id);
    try {
      await api.patch<Poll>(`/v1/admin/polls/${id}`, { status: "closed" });
      await reloadPolls();
      toast("Sondage fermé ✓", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setClosing(null);
    }
  };

  const polls = data ?? [];
  const active = polls.filter((p) => p.status === "active");
  const closed = polls.filter((p) => p.status === "closed");

  const renderPoll = (p: Poll) => (
    <div className="card" key={p.id} style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 12,
                background: p.status === "active" ? "var(--ok)" : "var(--panel-2)",
                color: p.status === "active" ? "#fff" : "var(--txt-dim)",
              }}
            >
              {p.status === "active" ? "EN DIRECT" : "FERMÉ"}
            </span>
            <span className="muted" style={{ fontSize: "0.78rem" }}>il y a {timeAgo(p.createdAt)}</span>
          </div>
          <h3 style={{ margin: "8px 0 10px", fontSize: "1.05rem" }}>{p.question}</h3>
        </div>
        {canManage && p.status === "active" && (
          <button className="btn btn-ghost btn-sm" disabled={closing === p.id} onClick={() => void closePoll(p.id)}>
            {closing === p.id ? "…" : "Fermer"}
          </button>
        )}
      </div>
      <LiveResults pollId={p.id} live={p.status === "active"} />
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <h1>Sondages en direct</h1>
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + Nouveau sondage
          </button>
        )}
      </div>

      <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
        Pose une question à l'antenne, les auditeurs votent depuis le site. Les résultats se mettent à jour en direct (5 s).
        {canManage ? " Ferme le sondage pour figer le résultat." : " Lecture seule pour ton rôle."}
      </p>

      {creating && <CreatePollModal onClose={() => setCreating(false)} onCreated={() => void reloadPolls()} />}

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void reloadPolls()} />
      ) : !data ? (
        <TableSkeleton cols={3} rows={3} />
      ) : polls.length === 0 ? (
        <Empty
          label="Aucun sondage."
          hint={canManage ? "Lance ton premier sondage pour interagir avec l'auditoire." : "Les sondages créés par l'animateur apparaîtront ici."}
          action={canManage ? <button className="btn btn-sm" onClick={() => setCreating(true)}>+ Nouveau sondage</button> : undefined}
        />
      ) : (
        <>
          {active.length > 0 && (
            <>
              <h2 style={{ fontSize: "0.95rem", margin: "0 0 10px" }}>En direct ({active.length})</h2>
              {active.map(renderPoll)}
            </>
          )}
          {closed.length > 0 && (
            <>
              <h2 style={{ fontSize: "0.95rem", margin: "18px 0 10px" }}>Archivés ({closed.length})</h2>
              {closed.map(renderPoll)}
            </>
          )}
        </>
      )}
    </div>
  );
}
