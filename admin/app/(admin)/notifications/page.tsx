"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Spinner, Field, Forbidden, ErrorState } from "@/components/ui";
import type { PushStats, Show } from "@/lib/types";

export default function NotificationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<PushStats | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [showSlug, setShowSlug] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // En cas d'échec on NE fabrique PAS un état « inactif/0 » (qui ferait passer
    // une panne pour Web Push désactivé) → stats reste null + état erreur.
    setError(null);
    setStats(null);
    try {
      const [s, sh] = await Promise.all([
        api.get<PushStats>("/v1/admin/push/stats"),
        api.get<Show[]>("/v1/admin/shows"),
      ]);
      setStats(s);
      setShows(sh);
    } catch {
      setError("Impossible de charger l'état des notifications.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      toast("Titre et message requis", "warn");
      return;
    }
    setSending(true);
    try {
      const res = await api.post<{ sent: number }>("/v1/admin/push/notify", {
        showSlug: showSlug || null,
        title: title.trim(),
        body: body.trim(),
      });
      toast(`Envoyé à ${res.sent} abonné(s) ✓`, "ok");
      setTitle("");
      setBody("");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setSending(false);
    }
  };

  if (user?.role !== "superadmin") {
    return (
      <div>
        <div className="page-head">
          <h1>Notifications</h1>
        </div>
        <Forbidden label="Réservé aux super-administrateurs." hint="L'envoi de notifications push n'est accessible qu'aux super-administrateurs." />
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!stats) return <Spinner label="Chargement des notifications…" />;

  return (
    <div>
      <div className="page-head">
        <h1>Notifications push</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          Rafraîchir
        </button>
      </div>

      {!stats.enabled && (
        <p className="muted" role="status" style={{ marginBottom: 16 }}>
          <span aria-hidden="true">⚠️</span> Web Push n&apos;est pas encore activé. Génère les clés VAPID
          (<code>npm run vapid</code> dans le dossier api) et ajoute{" "}
          <code>VAPID_PUBLIC_KEY</code> / <code>VAPID_PRIVATE_KEY</code> aux variables du service api.
        </p>
      )}

      <div className="cards-grid" style={{ marginBottom: 20 }}>
        <div className="card stat-card">
          <div className="label">Abonnés (total)</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="card stat-card">
          <div className="label">Abonnés à tous les rappels</div>
          <div className="value">{stats.global}</div>
        </div>
        <div className="card stat-card" style={{ borderLeft: `4px solid ${stats.enabled ? "var(--ok)" : "var(--danger)"}` }}>
          <div className="label">État</div>
          <div className="value" style={{ fontSize: "1rem" }}>
            {stats.enabled ? <>Actif <span aria-hidden="true">✓</span></> : "Inactif"}
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ marginTop: 0 }}>Diffuser une annonce</h2>
        <Field label="Cible">
          <select value={showSlug} onChange={(e) => setShowSlug(e.target.value)}>
            <option value="">Tout le monde</option>
            {shows.map((s) => (
              <option key={s.id} value={s.slug}>
                Abonnés de « {s.title} »
              </option>
            ))}
          </select>
        </Field>
        <Field label="Titre">
          <input type="text" value={title} maxLength={120} placeholder="🔴 Live spécial ce soir"
            onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Message">
          <textarea value={body} maxLength={300} placeholder="On t'attend à 20h pour…"
            onChange={(e) => setBody(e.target.value)} />
        </Field>
        <button className="btn btn-primary" onClick={send} disabled={sending || !stats.enabled}>
          {sending ? "Envoi…" : "Envoyer la notification"}
        </button>
      </div>
    </div>
  );
}
