"use client";

/* Boundary d'erreur racine (audit 2026-08-16) : remplace le document entier
   quand l'erreur remonte jusqu'au layout. Styles inline — globals.css peut
   être indisponible dans ce cas. */

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          background: "#0a0a0a",
          color: "#eaeaea",
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
        }}
      >
        <div role="alert" style={{ textAlign: "center" }}>
          <p>Une erreur inattendue est survenue.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 12, padding: "8px 16px", cursor: "pointer" }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
