"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Spinner } from "@/components/ui";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

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

  useEffect(() => {
    if (!drawerOpen) return;
    const sidebar = document.getElementById("admin-sidebar");
    if (!sidebar) return;

    const shell = document.querySelector(".admin-shell");
    const bg = shell
      ? Array.from(shell.children).filter((el) => el !== sidebar && !sidebar.contains(el))
      : Array.from(document.body.children).filter((el) => el !== sidebar && !sidebar.contains(el));
    const restored = bg.map((el) => ({
      el,
      inert: el.hasAttribute("inert"),
      hidden: el.getAttribute("aria-hidden"),
    }));
    bg.forEach((el) => {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    });

    const focusables = () =>
      Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !sidebar.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !sidebar.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    sidebar.addEventListener("keydown", onKeydown);
    const first = focusables()[0];
    first?.focus();

    return () => {
      sidebar.removeEventListener("keydown", onKeydown);
      restored.forEach(({ el, inert, hidden }) => {
        if (!inert) el.removeAttribute("inert");
        if (hidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", hidden);
      });
      menuBtnRef.current?.focus();
    };
  }, [drawerOpen]);

  if (!ready) return <div className="login-wrap"><Spinner label="Vérification de la session…" /></div>;
  if (!user) return null;

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">Aller au contenu</a>
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div
        className={`scrim${drawerOpen ? " open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <main className="main" id="admin-main">
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
          ref={menuBtnRef}
          type="button"
          className="menu-toggle"
          aria-expanded={drawerOpen}
          aria-controls="admin-sidebar"
          aria-label={drawerOpen ? "Fermer le menu de navigation" : "Ouvrir le menu de navigation"}
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
