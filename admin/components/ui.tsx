"use client";

import { type ReactNode, useEffect } from "react";

/* ── Modal ── */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ── Champs ── */
interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function Empty({ label = "Rien à afficher." }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

/* ── Confirmation de suppression ── */
export function ConfirmDelete({
  what,
  onConfirm,
  onCancel,
}: {
  what: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title="Confirmer la suppression" onClose={onCancel}>
      <p className="muted">
        Supprimer <strong>{what}</strong> ? Cette action est irréversible.
      </p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          Supprimer
        </button>
      </div>
    </Modal>
  );
}
