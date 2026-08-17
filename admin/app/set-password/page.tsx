"use client";

/* Page publique (hors layout admin) : définir / réinitialiser le mot de passe
   à partir d'un jeton reçu par email (invitation ou « mot de passe oublié »). */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { PasswordField } from "@/components/ui";

function SetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  // Jeton capturé au 1er rendu puis retiré de l'URL (audit 2026-08-16) : dans
  // la query string, il fuite via l'historique navigateur et l'en-tête Referer.
  const tokenRef = useRef<string | null>(null);
  if (tokenRef.current === null) tokenRef.current = params.get("token") ?? "";
  const token = tokenRef.current;
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  // Refs sur les conteneurs (PasswordField ne forwarde pas de ref) : on cible
  // l'input interne pour focaliser le 1er champ fautif après une erreur.
  const passwordWrapRef = useRef<HTMLDivElement>(null);
  const confirmWrapRef = useRef<HTMLDivElement>(null);
  const focusInput = (wrap: React.RefObject<HTMLDivElement | null>) =>
    wrap.current?.querySelector("input")?.focus();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 12) {
      setError("Le mot de passe doit faire au moins 12 caractères.");
      focusInput(passwordWrapRef);
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      focusInput(confirmWrapRef);
      return;
    }
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
        <p role="status" style={{ color: "var(--ok)", marginTop: 16 }}>
          Mot de passe enregistré <span aria-hidden="true">✓</span> Redirection vers la connexion…
        </p>
      </div>
    );
  }

  return (
    <div className="card login-card">
      <div className="brand"><span className="dot" /> Hits Dance Music</div>
      <h2 className="center" style={{ marginBottom: 18 }}>Définir mon mot de passe</h2>
      <form onSubmit={submit}>
        <div ref={passwordWrapRef}>
          <PasswordField
            label="Nouveau mot de passe (≥ 12 car.)"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
          />
        </div>
        <div ref={confirmWrapRef}>
          <PasswordField
            label="Confirmer"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy}
          aria-busy={busy}
        >
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
