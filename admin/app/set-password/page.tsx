"use client";

/* Page publique (hors layout admin) : définir / réinitialiser le mot de passe
   à partir d'un jeton reçu par email (invitation ou « mot de passe oublié »). */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Field } from "@/components/ui";

function SetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 12) return setError("Le mot de passe doit faire au moins 12 caractères.");
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    try {
      await api.post("/auth/set-password", { token, password });
      setDone(true);
      setTimeout(() => router.replace("/login"), 1800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lien invalide ou expiré.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="card login-card">
        <p className="error-text">Lien invalide : jeton manquant.</p>
        <Link className="btn btn-ghost" href="/login">Retour à la connexion</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card login-card">
        <div className="brand"><span className="dot" /> Hits Dance Music</div>
        <p style={{ color: "var(--ok)", marginTop: 16 }}>
          Mot de passe enregistré ✓ Redirection vers la connexion…
        </p>
      </div>
    );
  }

  return (
    <div className="card login-card">
      <div className="brand"><span className="dot" /> Hits Dance Music</div>
      <h2 className="center" style={{ marginBottom: 18 }}>Définir mon mot de passe</h2>
      <form onSubmit={submit}>
        <Field label="Nouveau mot de passe (≥ 12 car.)">
          <input type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Confirmer">
          <input type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
          {busy ? "Enregistrement…" : "Définir le mot de passe"}
        </button>
      </form>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="login-wrap">
      <Suspense fallback={<div className="card login-card">Chargement…</div>}>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
