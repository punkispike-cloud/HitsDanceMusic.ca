/* Lecture + validation des variables d'environnement.
   Posture « presence » : on REFUSE de démarrer si un secret critique manque
   ou est trop faible, plutôt que de booter dans un état non sécurisé. */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`[api] ❌ variable d'environnement requise manquante : ${name}`);
    process.exit(1);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function intOpt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

const NODE_ENV = optional("NODE_ENV", "development");
const isProd = NODE_ENV === "production";

const JWT_SECRET = required("JWT_SECRET");
if (JWT_SECRET.length < 32) {
  console.error("[api] ❌ JWT_SECRET trop court (< 32 caractères). Générer : openssl rand -base64 48");
  process.exit(1);
}
const WEAK_SECRETS = ["dev-only-change-me-please-32-bytes-minimum-secret", "change-me", "secret"];
if (isProd && WEAK_SECRETS.includes(JWT_SECRET)) {
  console.error("[api] ❌ JWT_SECRET par défaut interdit en production.");
  process.exit(1);
}

// Origines toujours autorisées (domaines de prod connus), FUSIONNÉES avec la
// variable ALLOWED_ORIGINS. Garantit que l'admin et le site fonctionnent même
// si la variable d'env est incomplète. Domaines spécifiques (pas de wildcard)
// → reste sûr. À nettoyer quand des domaines custom seront en place.
const BUILTIN_ORIGINS = [
  "https://hitsdancemusic.ca",
  "https://www.hitsdancemusic.ca",
  "https://zucchini-charisma-production-3a67.up.railway.app", // admin (Railway)
];

const ALLOWED_ORIGINS = [
  ...new Set([
    ...BUILTIN_ORIGINS,
    ...optional("ALLOWED_ORIGINS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]),
];

if (ALLOWED_ORIGINS.includes("*")) {
  console.warn("[api] ⚠️  ALLOWED_ORIGINS contient '*' — à NE PAS utiliser en production.");
}

export const env = {
  NODE_ENV,
  isProd,
  PORT: intOpt("PORT", 8082),
  DATABASE_URL: required("DATABASE_URL"),
  ALLOWED_ORIGINS,

  JWT_SECRET,
  ACCESS_TOKEN_TTL: intOpt("ACCESS_TOKEN_TTL", 900), // 15 min
  REFRESH_TOKEN_TTL: intOpt("REFRESH_TOKEN_TTL", 2_592_000), // 30 j
  BCRYPT_COST: intOpt("BCRYPT_COST", 12),

  MAX_BODY_BYTES: intOpt("MAX_BODY_BYTES", 1_048_576),
  RATE_LIMIT_RPM: intOpt("RATE_LIMIT_RPM", 120),
  AUTH_RATE_LIMIT_RPM: intOpt("AUTH_RATE_LIMIT_RPM", 10),

  SEED_ADMIN_EMAIL: optional("SEED_ADMIN_EMAIL", ""),
  SEED_ADMIN_PASSWORD: optional("SEED_ADMIN_PASSWORD", ""),

  // URL publique du site (liens RSS, partage, emails). Sans slash final requis.
  PUBLIC_SITE_URL: optional("PUBLIC_SITE_URL", "https://hitsdancemusic.ca"),

  // Rétention analytics (Loi 25) : purge des sessions/écoutes plus vieilles que N jours.
  ANALYTICS_RETENTION_DAYS: intOpt("ANALYTICS_RETENTION_DAYS", 180),

  // Sentry (monitoring d'erreurs) — inactif tant que le DSN n'est pas fourni.
  SENTRY_DSN: optional("SENTRY_DSN", ""),

  // Resend (emails transactionnels) — inactif tant que la clé n'est pas fournie.
  RESEND_API_KEY: optional("RESEND_API_KEY", ""),
  EMAIL_FROM: optional("EMAIL_FROM", "Hits Dance Music <no-reply@hitsdancemusic.ca>"),
  ADMIN_BASE_URL: optional("ADMIN_BASE_URL", "https://zucchini-charisma-production-3a67.up.railway.app"),

  // Web Push (VAPID) — généré une fois (npm run vapid). Inactif si absent.
  VAPID_PUBLIC_KEY: optional("VAPID_PUBLIC_KEY", ""),
  VAPID_PRIVATE_KEY: optional("VAPID_PRIVATE_KEY", ""),
  VAPID_SUBJECT: optional("VAPID_SUBJECT", "mailto:admin@hitsdancemusic.ca"),

  // S3 (Phase 4) — optionnel tant que les uploads ne sont pas activés
  S3_REGION: optional("S3_REGION", ""),
  S3_BUCKET: optional("S3_BUCKET", ""),
  S3_ACCESS_KEY_ID: optional("S3_ACCESS_KEY_ID", ""),
  S3_SECRET_ACCESS_KEY: optional("S3_SECRET_ACCESS_KEY", ""),
  S3_PUBLIC_BASE_URL: optional("S3_PUBLIC_BASE_URL", ""),
  MAX_AUDIO_BYTES: intOpt("MAX_AUDIO_BYTES", 524_288_000), // 500 Mo
} as const;

/** Le stockage S3 est-il configuré ? (gate les routes d'upload) */
export function isS3Configured(): boolean {
  return Boolean(env.S3_REGION && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

/** Sentry actif ? (sinon les erreurs restent en console — comportement actuel) */
export function isSentryConfigured(): boolean {
  return Boolean(env.SENTRY_DSN);
}

/** Resend (emails) actif ? */
export function isResendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** Web Push (VAPID) actif ? */
export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}
