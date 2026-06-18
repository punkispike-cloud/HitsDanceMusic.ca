"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const LINKS: { href: string; label: string; minRole?: "superadmin" }[] = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/statistiques", label: "Statistiques" },
  { href: "/grille", label: "Grille horaire" },
  { href: "/animateurs", label: "Animateurs" },
  { href: "/emissions", label: "Émissions" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/mixes", label: "Mixes" },
  { href: "/utilisateurs", label: "Utilisateurs", minRole: "superadmin" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" /> Hits Dance
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {LINKS.filter((l) => !l.minRole || user?.role === "superadmin").map((l) => (
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
          {user?.role}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12, width: "100%" }} onClick={() => void logout()}>
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
