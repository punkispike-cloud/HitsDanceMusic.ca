"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { Field } from "@/components/ui";

export default function LoginPage() {
  const { user, ready, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // Déjà connecté → dashboard
  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  const forgot = async () => {
    setError("");
    setNotice("");
    if (!email) return setError("Entre ton email d'abord.");
    try {
      await api.post("/auth/forgot-password", { email });
      setNotice("Si un compte existe, un lien de réinitialisation vient d'être envoyé.");
    } catch {
      setNotice("Si un compte existe, un lien de réinitialisation vient d'être envoyé.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      router.replace("/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Connexion impossible";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand">
          <span className="dot" /> Hits Dance Music
        </div>
        <h2 className="center" style={{ marginBottom: 18 }}>
          Console d&apos;administration
        </h2>
        <form onSubmit={submit}>
          <Field label="Email">
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Mot de passe">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <p className="error-text">{error}</p>}
          {notice && <p style={{ color: "var(--ok)", fontSize: "0.85rem" }}>{notice}</p>}
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </form>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12, width: "100%" }}
          onClick={() => void forgot()}>
          Mot de passe oublié ?
        </button>
      </div>
    </div>
  );
}
