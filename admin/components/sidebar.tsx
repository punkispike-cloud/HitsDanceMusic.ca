"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { isEditorialAdmin, isCrossRadio, isOnAir, ROLE_LABEL, type Role } from "@/lib/types";

/* Visibilité du menu par AXES de capacité (éditorial vs cross-radio) plutôt que
   par rang linéaire — sinon `it` (rang 4) passerait les anciens `minRole`.
   - it voit : dashboard, statistiques, parc (monitoring), journal, notifications.
   - it ne voit PAS : animateurs, emissions, podcasts, mixes, grille, utilisateurs.
   - owner voit tout ; superadmin voit l'éditorial + utilisateurs (pas parc). */
const LINKS: { href: string; label: string; canSee: (role: Role) => boolean }[] = [
  { href: "/parc", label: "Parc (radios)", canSee: isCrossRadio },
  { href: "/dashboard", label: "Tableau de bord", canSee: () => true },
  { href: "/statistiques", label: "Statistiques", canSee: () => true },
  { href: "/grille", label: "Grille horaire", canSee: (r) => r !== "it" },
  { href: "/animateurs", label: "Animateurs", canSee: (r) => r !== "it" },
  { href: "/emissions", label: "Émissions", canSee: (r) => r !== "it" },
  { href: "/featured", label: "À la une", canSee: isEditorialAdmin },
  { href: "/podcasts", label: "Podcasts", canSee: (r) => r !== "it" },
  { href: "/mixes", label: "Mixes", canSee: (r) => r !== "it" },
  { href: "/pistes", label: "Pistes", canSee: (r) => r !== "it" },
  { href: "/studio", label: "Studio DJ", canSee: (r) => r !== "it" },
  { href: "/demandes", label: "Demandes", canSee: isOnAir },
  { href: "/sondages", label: "Sondages", canSee: isOnAir },
  { href: "/notifications", label: "Notifications", canSee: (r) => isCrossRadio(r) || r === "superadmin" },
  { href: "/utilisateurs", label: "Utilisateurs", canSee: isEditorialAdmin },
  { href: "/journal", label: "Journal d'audit", canSee: (r) => isCrossRadio(r) || r === "superadmin" },
  { href: "/compte", label: "Mon compte", canSee: () => true },
];

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { radios, selectedId, selectRadio, isCrossRadio } = useRadio();

  const currentRadio =
    radios.find((r) => r.id === selectedId) ?? (radios.length === 1 ? radios[0] : undefined);

  // Ferme le drawer quand la route change (navigation) ou via Escape.
  useEffect(() => {
    if (open) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside id="admin-sidebar" className={`sidebar${open ? " open" : ""}`}>
      <div className="brand">
        <span className="dot" /> En Ondes
      </div>

      {isCrossRadio && radios.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="sidebar-radio-select" style={{ fontSize: 11, color: "var(--txt-dim)", display: "block", marginBottom: 4 }}>
            Radio administrée
          </label>
          <select
            id="sidebar-radio-select"
            value={currentRadio?.id ?? ""}
            onChange={(e) => selectRadio(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 8px",
              borderRadius: 6,
              background: "var(--panel-2)",
              color: "var(--txt)",
              border: "1px solid var(--line-2)",
            }}
          >
            {!currentRadio && <option value="">— choisir —</option>}
            {radios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {LINKS.filter((l) => l.canSee(user?.role ?? "lecteur")).map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="spacer" />
      <div className="user-box">
        <div style={{ fontWeight: 700, color: "var(--txt)" }}>{user?.displayName}</div>
        <div className={`role-badge role-${user?.role}`} style={{ marginTop: 6, display: "inline-block" }}>
          {user ? ROLE_LABEL[user.role] : ""}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          style={{ marginTop: 12, width: "100%" }}
          onClick={() => void logout()}
        >
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
