"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Spinner, Empty, Field } from "@/components/ui";
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

  const load = useCallback(async () => {
    try {
      const [s, sh] = await Promise.all([
        api.get<PushStats>("/v1/admin/push/stats"),
        api.get<Show[]>("/v1/admin/shows"),
      ]);
      setStats(s);
      setShows(sh);
    } catch {
      setStats({ enabled: false, total: 0, global: 0 });
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
        <Empty label="Réservé aux super-administrateurs." />
      </div>
    );
  }

  if (!stats) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1>Notifications push</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
          ↻ Rafraîchir
        </button>
      </div>

      {!stats.enabled && (
        <p className="muted" style={{ marginBottom: 16 }}>
          ⚠️ Web Push n&apos;est pas encore activé. Génère les clés VAPID
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
          <div className="value" style={{ fontSize: "1rem" }}>{stats.enabled ? "Actif ✓" : "Inactif"}</div>
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
