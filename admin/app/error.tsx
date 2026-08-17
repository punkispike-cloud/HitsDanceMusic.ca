"use client";

/* Boundary d'erreur App Router (audit 2026-08-16) : sans elle, une erreur de
   rendu dans une section affichait la page d'erreur générique Next.js. */

import { ErrorState } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: 24 }}>
      <ErrorState
        message="Une erreur est survenue dans cette section."
        onRetry={reset}
      />
    </div>
  );
}
