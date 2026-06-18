"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Spinner } from "@/components/ui";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready) return <div className="login-wrap"><Spinner label="Vérification de la session…" /></div>;
  if (!user) return null; // redirection en cours

  return (
    <div className="admin-shell">
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}
