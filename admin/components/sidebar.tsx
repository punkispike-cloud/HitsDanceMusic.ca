"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { roleAtLeast, ROLE_LABEL, type Role } from "@/lib/types";

const LINKS: { href: string; label: string; minRole?: Role }[] = [
  { href: "/parc", label: "Parc (radios)", minRole: "owner" },
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/statistiques", label: "Statistiques" },
  { href: "/grille", label: "Grille horaire" },
  { href: "/animateurs", label: "Animateurs" },
  { href: "/emissions", label: "Émissions" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/mixes", label: "Mixes" },
  { href: "/notifications", label: "Notifications", minRole: "superadmin" },
  { href: "/utilisateurs", label: "Utilisateurs", minRole: "superadmin" },
  { href: "/journal", label: "Journal d'audit", minRole: "superadmin" },
  { href: "/compte", label: "Mon compte" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { radios, selectedId, selectRadio, isOwner } = useRadio();

  const currentRadio =
    radios.find((r) => r.id === selectedId) ?? (radios.length === 1 ? radios[0] : undefined);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" /> En Ondes
      </div>

      {isOwner && radios.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#9aa", display: "block", marginBottom: 4 }}>
            Radio administrée
          </label>
          <select
            aria-label="Radio administrée"
            value={currentRadio?.id ?? ""}
            onChange={(e) => selectRadio(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 8px",
              borderRadius: 6,
              background: "var(--panel2, #0f0f14)",
              color: "var(--txt, #eee)",
              border: "1px solid var(--border, #2a2a33)",
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
        {LINKS.filter((l) => !l.minRole || roleAtLeast(user?.role, l.minRole)).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link ${pathname.startsWith(l.href) ? "active" : ""}`}
          >
            {l.label}
          </Link>
        ))}
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
