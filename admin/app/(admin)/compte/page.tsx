"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { Field } from "@/components/ui";

export default function ComptePage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (newPassword.length < 12) {
      toast("Le nouveau mot de passe doit faire au moins 12 caractères", "warn");
      return;
    }
    if (newPassword !== confirm) {
      toast("Les deux mots de passe ne correspondent pas", "warn");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", { oldPassword, newPassword });
      toast("Mot de passe changé ✓ Reconnecte-toi.", "ok");
      // Le changement révoque toutes les sessions → on déconnecte proprement.
      setTimeout(() => void logout(), 1200);
    } catch (e) {
      toast((e as ApiError).message, "error");
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Mon compte</h1>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Connecté en tant que <strong>{user?.email}</strong> ({user?.role}).
        </p>
        <h2>Changer mon mot de passe</h2>
        <Field label="Mot de passe actuel">
          <input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)}
            autoComplete="current-password" />
        </Field>
        <Field label="Nouveau mot de passe (≥ 12 car.)">
          <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)}
            autoComplete="new-password" />
        </Field>
        <Field label="Confirmer le nouveau mot de passe">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" />
        </Field>
        <button className="btn btn-primary" onClick={submit} disabled={saving || !oldPassword || !newPassword}>
          {saving ? "Changement…" : "Changer le mot de passe"}
        </button>
      </div>
    </div>
  );
}
