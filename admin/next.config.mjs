/** @type {import('next').NextConfig} */

/* Headers de sécurité (audit 2026-08-16) : la console admin est servie par
   Next standalone — pas de nginx devant pour poser ces en-têtes. */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
let apiOrigin = "";
try {
  apiOrigin = apiUrl ? new URL(apiUrl).origin : "";
} catch {
  apiOrigin = "";
}

/* connect-src : l'API + l'ingest Sentry sont nommés explicitement ; le `https:`
   final couvre les uploads présignés S3/R2 dont l'hôte exact dépend de la
   config runtime (S3_ENDPOINT/S3_PUBLIC_BASE_URL côté API). */
const connectSrc = ["'self'", apiOrigin, "https://*.ingest.sentry.io", "https:"]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  // Next.js injecte des scripts inline d'hydratation → 'unsafe-inline' requis
  // (une CSP stricte par nonce demanderait un middleware dédié).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  `connect-src ${connectSrc}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig = {
  // Image standalone pour Docker/Railway (n'embarque que le nécessaire).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
