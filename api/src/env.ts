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

// Origines CORS autorisées — UNIQUEMENT via la variable d'env ALLOWED_ORIGINS
// (C1.4 : retrait des origines hardcodées). En prod, ops DOIT lister ici tous les
// domaines qui parlent à l'API : site public + admin + hub (ex. :
// `https://hitsdancemusic.ca,https://admin.hitsdancemusic.ca`). Domaines spécifiques
// (pas de wildcard) → reste sûr. Voir api/README.md § CORS.
const ALLOWED_ORIGINS = [
  ...new Set(
    optional("ALLOWED_ORIGINS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

if (ALLOWED_ORIGINS.length === 0) {
  console.warn("[api] ⚠️  ALLOWED_ORIGINS vide — aucune origine navigateur ne sera autorisée (CORS). Renseigner la variable en prod (site + admin + hub).");
}
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
  // Compte PROPRIÉTAIRE (En Ondes) — rôle `owner`, au-dessus de l'admin client.
  // Posé uniquement sur les instances de l'hôte. Crée le compte s'il manque,
  // PROMEUT en owner s'il existe déjà (migration douce d'un superadmin existant).
  SEED_OWNER_EMAIL: optional("SEED_OWNER_EMAIL", ""),
  SEED_OWNER_PASSWORD: optional("SEED_OWNER_PASSWORD", ""),
  // Compte IT (technique cross-radio) — rôle `it`, monitoring parc SANS accès
  // éditorial/commercial. Optionnel, en miroir du compte owner. radioId NULL.
  SEED_IT_EMAIL: optional("SEED_IT_EMAIL", ""),
  SEED_IT_PASSWORD: optional("SEED_IT_PASSWORD", ""),
  SEED_IT_NAME: optional("SEED_IT_NAME", "Équipe IT"),
  // Marque seedée : "hitsdance" → contenu démo Hits Dance. Tout autre valeur
  // (= nouveau client) → DB de contenu vierge, à remplir via l'admin.
  SEED_BRAND: optional("SEED_BRAND", "hitsdance"),
  // Nom affiché de la radio (tenant). Défaut : dérivé de SEED_BRAND.
  SEED_RADIO_NAME: optional("SEED_RADIO_NAME", ""),

  // URL publique du site (liens RSS, partage, emails). Sans slash final requis.
  PUBLIC_SITE_URL: optional("PUBLIC_SITE_URL", "https://hitsdancemusic.ca"),

  // Now-playing du flux (7.html SHOUTcast / JSON) — interrogé par le poller
  // d'historique des titres. Vide → poller inactif.
  NOWPLAYING_URL: optional("NOWPLAYING_URL", ""),

  // Rétention analytics (Loi 25) : purge des sessions/écoutes plus vieilles que N jours.
  ANALYTICS_RETENTION_DAYS: intOpt("ANALYTICS_RETENTION_DAYS", 180),

  // Surveillance du flux (dead-air / injoignable). Le monitor met toujours à jour
  // l'état de santé ; les ALERTES (courriel) ne partent que si Resend est configuré.
  MONITOR_ENABLED: optional("MONITOR_ENABLED", "true"),
  MONITOR_INTERVAL_MS: intOpt("MONITOR_INTERVAL_MS", 120_000), // 2 min
  STREAM_SILENCE_MIN: intOpt("STREAM_SILENCE_MIN", 30), // titre inchangé > N min ⇒ dead-air suspecté
  ALERT_DEBOUNCE_MIN: intOpt("ALERT_DEBOUNCE_MIN", 60), // pas de ré-alerte avant N min

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

  // AzuraCast (flux managé derrière la marque) — inactif si non fourni.
  // Le provisioning crée alors le tenant sans station de flux.
  AZURACAST_BASE_URL: optional("AZURACAST_BASE_URL", ""),
  AZURACAST_API_KEY: optional("AZURACAST_API_KEY", ""),
  // Replay / catch-up : ingère les enregistrements AzuraCast en brouillons
  // d'épisodes. DÉSACTIVÉ par défaut — activer explicitement en prod une fois
  // l'API recordings d'AzuraCast validée. Inactif tant que AzuraCast n'est pas
  // configuré (cf. isReplayEnabled).
  AZURACAST_REPLAY_ENABLED: optional("AZURACAST_REPLAY_ENABLED", "false"),
  REPLAY_INTERVAL_MS: intOpt("REPLAY_INTERVAL_MS", 15 * 60_000), // 15 min

  // Stripe (facturation Phase 5) — inactif tant que les secrets ne sont pas fournis.
  // Le webhook vérifie la signature Stripe avec STRIPE_WEBHOOK_SECRET (lib `stripe` à ajouter).
  STRIPE_SECRET: optional("STRIPE_SECRET", ""),
  STRIPE_WEBHOOK_SECRET: optional("STRIPE_WEBHOOK_SECRET", ""),

  // S3 (Phase 4) — optionnel tant que les uploads ne sont pas activés.
  // Compatible Cloudflare R2 (S3 API) : poser S3_ENDPOINT + S3_REGION="auto"
  // (+ S3_FORCE_PATH_STYLE="true") pointe le client vers R2 au lieu d'AWS.
  S3_REGION: optional("S3_REGION", ""),
  S3_BUCKET: optional("S3_BUCKET", ""),
  S3_ACCESS_KEY_ID: optional("S3_ACCESS_KEY_ID", ""),
  S3_SECRET_ACCESS_KEY: optional("S3_SECRET_ACCESS_KEY", ""),
  S3_PUBLIC_BASE_URL: optional("S3_PUBLIC_BASE_URL", ""),
  // Endpoint S3 personnalisé (ex. R2 : https://<accountid>.r2.cloudflarestorage.com).
  // Vide → comportement AWS par défaut (rétro-compatible).
  S3_ENDPOINT: optional("S3_ENDPOINT", ""),
  // R2 préfère le path-style ; vide/"false" → virtual-hosted (AWS par défaut).
  S3_FORCE_PATH_STYLE: optional("S3_FORCE_PATH_STYLE", ""),
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

/** Stripe (facturation) actif ? */
export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_WEBHOOK_SECRET);
}

/** Surveillance du flux active ? (sinon aucun suivi de santé en arrière-plan) */
export function isMonitorEnabled(): boolean {
  return env.MONITOR_ENABLED === "true";
}

/** Replay / catch-up actif ? Exige AzuraCast configuré ET le flag explicite
 *  AZURACAST_REPLAY_ENABLED=true (désactivé par défaut — l'ingestion des
 *  enregistrements en brouillons n'est lancée qu'après validation de l'API). */
export function isReplayEnabled(): boolean {
  return (
    env.AZURACAST_REPLAY_ENABLED === "true" &&
    Boolean(env.AZURACAST_BASE_URL && env.AZURACAST_API_KEY)
  );
}
