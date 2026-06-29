import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { RadioProvider } from "@/lib/radio";
import { SWRProvider } from "@/lib/swr";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: "Admin — Hits Dance Music",
  description: "Console d'administration de la radio Hits Dance Music",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AuthProvider>
          <RadioProvider>
            <SWRProvider>
              <ToastProvider>{children}</ToastProvider>
            </SWRProvider>
          </RadioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
