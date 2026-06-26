"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/toast";
import { PasswordField } from "@/components/ui";

export default function ComptePage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  // Refs sur les conteneurs (PasswordField ne forwarde pas de ref) : on cible
  // l'input interne pour focaliser le 1er champ fautif après une erreur.
  const newWrapRef = useRef<HTMLDivElement>(null);
  const confirmWrapRef = useRef<HTMLDivElement>(null);
  const focusInput = (wrap: React.RefObject<HTMLDivElement | null>) =>
    wrap.current?.querySelector("input")?.focus();

  const submit = async () => {
    if (newPassword.length < 12) {
      toast("Le nouveau mot de passe doit faire au moins 12 caractères", "warn");
      focusInput(newWrapRef);
      return;
    }
    if (newPassword !== confirm) {
      toast("Les deux mots de passe ne correspondent pas", "warn");
      focusInput(confirmWrapRef);
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
        <PasswordField
          label="Mot de passe actuel"
          value={oldPassword}
          onChange={setOld}
          autoComplete="current-password"
        />
        <div ref={newWrapRef}>
          <PasswordField
            label="Nouveau mot de passe (≥ 12 car.)"
            value={newPassword}
            onChange={setNew}
            autoComplete="new-password"
            showStrength
          />
        </div>
        <div ref={confirmWrapRef}>
          <PasswordField
            label="Confirmer le nouveau mot de passe"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={saving || !oldPassword || !newPassword}
          aria-busy={saving}
        >
          {saving ? "Changement…" : "Changer le mot de passe"}
        </button>
      </div>
    </div>
  );
}
