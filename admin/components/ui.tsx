"use client";

import {
  type ReactNode,
  type ReactElement,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/* ── Modal accessible ──
   role=dialog + aria-modal, titre lié via aria-labelledby, focus initial sur
   le panneau, piège de focus (Tab boucle), Escape ferme, et restauration du
   focus sur l'élément déclencheur à la fermeture. Props inchangées ;
   `initialFocusRef` est optionnel (rétro-compatible). */
export function Modal({
  title,
  onClose,
  children,
  initialFocusRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Élément à focaliser à l'ouverture (sinon le panneau lui-même). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Mémorise l'élément actif pour restaurer le focus à la fermeture.
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus initial : ref fourni, sinon le panneau (tabIndex=-1).
    (initialFocusRef?.current ?? panel)?.focus();

    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restaure le focus sur le déclencheur.
      restoreRef.current?.focus?.();
    };
  }, [onClose, initialFocusRef]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* ── Champs ──
   Le label est désormais associé au contrôle via htmlFor/id (React.useId).
   L'API publique est inchangée : Field clone son unique enfant pour lui
   injecter `id` (sans casser un id déjà fourni par l'appelant). */
interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}
export function Field({ label, hint, children }: FieldProps) {
  const autoId = useId();
  let control = children;
  let controlId = autoId;
  // Injecte l'id sur l'unique élément de contrôle (input/textarea/select).
  if (isValidElement(children)) {
    const childProps = children.props as { id?: string };
    controlId = childProps.id ?? autoId;
    if (!childProps.id) {
      control = cloneElement(children as ReactElement<{ id?: string }>, { id: controlId });
    }
  }
  return (
    <div className="field">
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return <div className="loading" role="status">{label}</div>;
}

/* État vide, éventuellement actionnable : `hint` explique, `action` propose
   une porte de sortie (ex. « + Nouveau ») au lieu d'un cul-de-sac. */
export function Empty({
  label = "Rien à afficher.",
  hint,
  action,
}: {
  label?: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>{label}</div>
      {hint && <div className="muted" style={{ marginTop: 6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/* ── Accès refusé (distinct de l'état vide) ── */
export function Forbidden({
  label = "Accès refusé.",
  hint = "Vous n'avez pas les droits nécessaires pour cette section.",
}: {
  label?: string;
  hint?: string;
}) {
  return (
    <div className="empty" role="alert">
      <div style={{ fontWeight: 800, color: "var(--txt)" }}>{label}</div>
      <div style={{ marginTop: 6 }}>{hint}</div>
    </div>
  );
}

/* ── Squelette de tableau (shimmer, respecte reduced-motion via .skeleton) ── */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      <table className="data">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c}>
                  <div
                    className="skeleton skeleton-cell"
                    style={{ width: `${50 + ((r + c) % 4) * 12}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── État d'erreur réutilisable avec bouton Réessayer ── */
export function ErrorState({
  message = "Une erreur est survenue.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="empty" role="alert">
      <div style={{ color: "var(--txt)" }}>{message}</div>
      {onRetry && (
        <button className="btn btn-sm" type="button" onClick={onRetry} style={{ marginTop: 12 }}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/* ── Champ mot de passe avec bascule de visibilité (+ jauge de force) ── */
export function PasswordField({
  label,
  value,
  onChange,
  hint,
  autoComplete = "current-password",
  placeholder,
  showStrength = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  autoComplete?: string;
  placeholder?: string;
  /** Affiche une jauge de force (annoncée via aria-live). */
  showStrength?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ paddingRight: 84 }}
        />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-pressed={show}
          aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          onClick={() => setShow((s) => !s)}
          style={{ position: "absolute", right: 6 }}
        >
          {show ? "Masquer" : "Afficher"}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div aria-live="polite">
          <div
            style={{ height: 6, borderRadius: 4, background: "var(--panel-2)", marginTop: 8, overflow: "hidden" }}
            role="img"
            aria-label={`Force du mot de passe : ${strength.label}`}
          >
            <div
              style={{
                height: "100%",
                width: `${strength.pct}%`,
                background: strength.color,
                transition: "width 0.2s",
              }}
            />
          </div>
          <span className="hint">Force : {strength.label}</span>
        </div>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function passwordStrength(pw: string): { pct: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { pct: 33, label: "faible", color: "var(--danger)" };
  if (score === 3) return { pct: 66, label: "moyen", color: "var(--warn)" };
  return { pct: 100, label: "fort", color: "var(--ok)" };
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
