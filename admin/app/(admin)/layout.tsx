"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useRadio } from "@/lib/radio";
import { Sidebar } from "@/components/sidebar";
import { Spinner } from "@/components/ui";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const { epoch } = useRadio();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // Surveille l'état de connexion réseau pour la bannière hors-ligne.
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!ready) return <div className="login-wrap"><Spinner label="Vérification de la session…" /></div>;
  if (!user) return null; // redirection en cours

  return (
    <div className="admin-shell">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div
        className={`scrim${drawerOpen ? " open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <main className="main" key={epoch}>
        {offline && (
          <div className="offline-bar" role="status">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m2 2 20 20" />
              <path d="M8.5 16.5a5 5 0 0 1 7 0" />
              <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
              <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
              <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
              <path d="M5 13a10 10 0 0 1 5.24-2.76" />
              <line x1="12" y1="20" x2="12.01" y2="20" />
            </svg>
            Hors ligne — les données affichées peuvent être périmées.
          </div>
        )}
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={drawerOpen}
          aria-controls="admin-sidebar"
          aria-label="Ouvrir le menu de navigation"
          onClick={() => setDrawerOpen((o) => !o)}
          style={{ marginBottom: 16 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          Menu
        </button>
        {children}
      </main>
    </div>
  );
}
