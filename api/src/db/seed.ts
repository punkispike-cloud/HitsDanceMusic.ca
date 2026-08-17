/* Seed idempotent : superadmin + animateurs + émissions + grille.
   - Artistes/émissions : upsert par slug.
   - Créneaux : purge + ré-insertion (la grille est un tout cohérent).
   Lancer : `npm run seed`. */

import { eq, sql, isNull, and, ne } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  users,
  artists,
  shows,
  scheduleSlots,
  radios,
  episodes,
  mixes,
  analyticsSessions,
  analyticsShowListen,
  trackHistory,
  pushSubscriptions,
  auditLog,
  uploadIntents,
  featuredItems,
} from "./schema.js";
import { hashPassword } from "../lib/password.js";
import { toMinutes } from "../lib/validation.js";
import { env } from "../env.js";
import type { SeedArtist, SeedShow, ScheduleRow } from "./seed-data.js";
import { loadSeedBundle } from "./seeds.js";

/* Opt-in (SEED_SYNC_PASSWORDS=1) : réécrit le hash depuis SEED_*_PASSWORD.
   Utile après restauration d'un backup plus ancien que le mot de passe actuel.
   Désactivé par défaut — un re-déploiement ne doit pas écraser un mdp changé dans l'admin. */
async function maybeSyncPassword(userId: string, password: string, email: string): Promise<void> {
  if (process.env.SEED_SYNC_PASSWORDS !== "1") return;
  await db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
  console.log(`[seed] mot de passe resynchronisé : ${email}`);
}

async function seedSuperadmin(radioId: string) {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.warn("[seed] SEED_ADMIN_EMAIL/PASSWORD absents — superadmin non créé.");
    return;
  }
  const existing = await db.query.users.findFirst({
    where: eq(users.email, env.SEED_ADMIN_EMAIL),
  });
  if (existing) {
    await maybeSyncPassword(existing.id, env.SEED_ADMIN_PASSWORD, env.SEED_ADMIN_EMAIL);
    console.log(`[seed] superadmin déjà présent : ${env.SEED_ADMIN_EMAIL}`);
    return;
  }
  if (env.SEED_ADMIN_PASSWORD === "change-me-now") {
    console.warn("[seed] ⚠️  mot de passe superadmin par défaut — à changer immédiatement !");
  }
  await db.insert(users).values({
    email: env.SEED_ADMIN_EMAIL,
    passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    displayName: "Super Admin",
    role: "superadmin",
    radioId,
  });
  console.log(`[seed] superadmin créé : ${env.SEED_ADMIN_EMAIL}`);
}

/* Compte PROPRIÉTAIRE En Ondes (rôle `owner`, cross-radio). Idempotent ET
   rejouable : crée le compte s'il manque, le PROMEUT en owner s'il existe déjà
   (ainsi un superadmin existant — ex. le compte hôte de Hits Dance — devient
   owner sans SQL manuel). Posé seulement si SEED_OWNER_* sont fournis. */
async function seedOwner() {
  if (!env.SEED_OWNER_EMAIL || !env.SEED_OWNER_PASSWORD) return;
  const existing = await db.query.users.findFirst({
    where: eq(users.email, env.SEED_OWNER_EMAIL),
  });
  if (existing) {
    await maybeSyncPassword(existing.id, env.SEED_OWNER_PASSWORD, env.SEED_OWNER_EMAIL);
    if (existing.role !== "owner") {
      await db.update(users).set({ role: "owner", updatedAt: new Date() }).where(eq(users.id, existing.id));
      console.log(`[seed] compte promu owner : ${env.SEED_OWNER_EMAIL}`);
    } else {
      console.log(`[seed] owner déjà présent : ${env.SEED_OWNER_EMAIL}`);
    }
    return;
  }
  await db.insert(users).values({
    email: env.SEED_OWNER_EMAIL,
    passwordHash: await hashPassword(env.SEED_OWNER_PASSWORD),
    displayName: "En Ondes (propriétaire)",
    role: "owner",
  });
  console.log(`[seed] owner créé : ${env.SEED_OWNER_EMAIL}`);
}

/* Compte IT En Ondes (rôle `it`, cross-radio, monitoring technique sans accès
   éditorial/commercial). Idempotent, en miroir du compte owner. Posé seulement
   si SEED_IT_* sont fournis. radioId NULL (cross-radio). On ne rétrograde
   jamais un owner existant. */
async function seedIt() {
  if (!env.SEED_IT_EMAIL || !env.SEED_IT_PASSWORD) return;
  const existing = await db.query.users.findFirst({
    where: eq(users.email, env.SEED_IT_EMAIL),
  });
  if (existing) {
    if (existing.role === "owner") {
      console.log(`[seed] compte owner existant pour ${env.SEED_IT_EMAIL} — laissé owner.`);
      return;
    }
    await maybeSyncPassword(existing.id, env.SEED_IT_PASSWORD, env.SEED_IT_EMAIL);
    if (existing.role !== "it") {
      await db.update(users).set({ role: "it", updatedAt: new Date() }).where(eq(users.id, existing.id));
      console.log(`[seed] compte promu it : ${env.SEED_IT_EMAIL}`);
    } else {
      console.log(`[seed] it déjà présent : ${env.SEED_IT_EMAIL}`);
    }
    return;
  }
  await db.insert(users).values({
    email: env.SEED_IT_EMAIL,
    passwordHash: await hashPassword(env.SEED_IT_PASSWORD),
    displayName: env.SEED_IT_NAME || "Équipe IT",
    role: "it",
  });
  console.log(`[seed] it créé : ${env.SEED_IT_EMAIL}`);
}

// Noms « jolis » connus pour les marques de départ ; sinon = le slug.
const RADIO_NAMES: Record<string, string> = {
  hitsdance: "Hits Dance Music",
  rockradio: "Radio Rockfort",
};

/* Garantit la ligne `radios` du tenant de cette instance (1 radio par
   déploiement, identifiée par SEED_BRAND). Idempotent. Renvoie son id. */
async function ensureDefaultRadio(): Promise<string> {
  const slug = env.SEED_BRAND;
  const name = env.SEED_RADIO_NAME || RADIO_NAMES[slug] || slug;
  const existing = await db.query.radios.findFirst({ where: eq(radios.slug, slug) });
  if (existing) return existing.id;
  const [row] = await db.insert(radios).values({ slug, name, status: "active" }).returning();
  console.log(`[seed] radio (tenant) créée : ${slug} (${name})`);
  return row!.id;
}

/* Back-remplit radio_id sur toute ligne orpheline (données créées AVANT le
   multi-tenant, ex. la prod Hits Dance existante). Idempotent : ne touche QUE
   radio_id IS NULL. Les comptes cross-radio (`owner` + `it`) restent à null. */
async function backfillRadioId(radioId: string): Promise<void> {
  await db.update(artists).set({ radioId }).where(isNull(artists.radioId));
  await db.update(shows).set({ radioId }).where(isNull(shows.radioId));
  await db.update(scheduleSlots).set({ radioId }).where(isNull(scheduleSlots.radioId));
  await db.update(episodes).set({ radioId }).where(isNull(episodes.radioId));
  await db.update(mixes).set({ radioId }).where(isNull(mixes.radioId));
  await db.update(analyticsSessions).set({ radioId }).where(isNull(analyticsSessions.radioId));
  await db.update(analyticsShowListen).set({ radioId }).where(isNull(analyticsShowListen.radioId));
  await db.update(trackHistory).set({ radioId }).where(isNull(trackHistory.radioId));
  await db.update(pushSubscriptions).set({ radioId }).where(isNull(pushSubscriptions.radioId));
  await db.update(auditLog).set({ radioId }).where(isNull(auditLog.radioId));
  await db.update(uploadIntents).set({ radioId }).where(isNull(uploadIntents.radioId));
  await db
    .update(users)
    .set({ radioId })
    .where(and(isNull(users.radioId), ne(users.role, "owner"), ne(users.role, "it")));
  console.log("[seed] radio_id back-rempli sur les lignes orphelines (idempotent).");
}

async function seedArtists(seedArtistList: SeedArtist[], radioId: string): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();
  for (const a of seedArtistList) {
    const [row] = await db
      .insert(artists)
      .values({
        radioId,
        slug: a.slug,
        name: a.name,
        photoUrl: a.photoUrl,
        initials: a.initials,
        showTitle: a.showTitle,
        scheduleText: a.scheduleText,
        bio: a.bio,
        sortOrder: a.sortOrder,
      })
      .onConflictDoUpdate({
        target: [artists.radioId, artists.slug],
        set: {
          name: a.name,
          photoUrl: a.photoUrl,
          initials: a.initials,
          showTitle: a.showTitle,
          scheduleText: a.scheduleText,
          bio: a.bio,
          sortOrder: a.sortOrder,
          updatedAt: new Date(),
        },
      })
      .returning();
    bySlug.set(a.slug, row!.id);
  }
  console.log(`[seed] ${seedArtistList.length} animateurs upsertés.`);
  return bySlug;
}

async function seedShows(seedShowList: SeedShow[], artistIdBySlug: Map<string, string>, radioId: string) {
  for (const s of seedShowList) {
    const slug = slugifyTitle(s.title);
    const artistId = s.artistSlug ? artistIdBySlug.get(s.artistSlug) ?? null : null;
    await db
      .insert(shows)
      .values({
        radioId,
        slug,
        title: s.title,
        badge: s.badge,
        tag: s.tag,
        description: s.description,
        artistId,
        scheduleText: s.scheduleText,
        sortOrder: s.sortOrder,
      })
      .onConflictDoUpdate({
        target: [shows.radioId, shows.slug],
        set: {
          title: s.title,
          badge: s.badge,
          tag: s.tag,
          description: s.description,
          artistId,
          scheduleText: s.scheduleText,
          sortOrder: s.sortOrder,
          updatedAt: new Date(),
        },
      });
  }
  console.log(`[seed] ${seedShowList.length} émissions upsertées.`);
}

async function seedSchedule(
  schedule: Record<number, ScheduleRow[]>,
  hostToArtistSlug: Record<string, string | null>,
  artistIdBySlug: Map<string, string>,
  radioId: string,
) {
  // Index titre d'émission → id (best-effort pour lier les créneaux), scopé radio.
  const showRows = await db
    .select({ id: shows.id, title: shows.title })
    .from(shows)
    .where(eq(shows.radioId, radioId));
  const showIdByTitle = new Map(showRows.map((r) => [r.title.toLowerCase(), r.id]));

  await db.delete(scheduleSlots).where(eq(scheduleSlots.radioId, radioId));
  let count = 0;
  for (let day = 0; day <= 6; day++) {
    for (const [from, to, title, host, tag] of schedule[day] ?? []) {
      const startMin = toMinutes(from);
      const endMin = to === "24:00" ? 1440 : toMinutes(to);
      if (startMin == null || endMin == null) {
        console.warn(`[seed] créneau ignoré (heure invalide) : ${day} ${from}-${to}`);
        continue;
      }
      const artistSlug = hostToArtistSlug[host];
      const artistId = artistSlug ? artistIdBySlug.get(artistSlug) ?? null : null;
      const showId = showIdByTitle.get(title.toLowerCase()) ?? null;
      await db.insert(scheduleSlots).values({
        radioId,
        dayOfWeek: day,
        startMin,
        endMin,
        title,
        hostLabel: host,
        tag,
        artistId,
        showId,
        isLive: /\(live\)/i.test(title),
      });
      count++;
    }
  }
  console.log(`[seed] ${count} créneaux insérés.`);
}

/** Seed « À la une » depuis le contenu hardcodé du site (idempotent : skip si déjà peuplé). */
async function seedFeaturedItems(radioId: string) {
  const existing = await db.select({ id: featuredItems.id }).from(featuredItems).limit(1);
  if (existing.length > 0) {
    console.log("[seed] featured_items déjà présents — skip.");
    return;
  }
  const homepage = [
    {
      kind: "homepage" as const,
      tag: "DRIVE",
      title: "Le Hit Drive (live)",
      meta: "Lun–Ven · 16h00–18h00 · avec Alain Perron",
      body: "Deux heures non-stop de hits dance et house pour rentrer du boulot — la signature de l'après-midi.",
      coverUrl: null,
      variant: "drive",
      sortOrder: 0,
    },
    {
      kind: "homepage" as const,
      tag: "DJ SET",
      title: "DJ JÜMPOFF — JÜMPOFFproject",
      meta: "Mer., jeu., ven., sam., dim.",
      body: "Mixes club et soirées signés JÜMPOFFproject — énergie dance et transitions léchées.",
      coverUrl: "assets/jumpoff.webp",
      variant: "jumpoff",
      sortOrder: 1,
    },
    {
      kind: "homepage" as const,
      tag: "EUROPE",
      title: "DJ OSKANA",
      meta: "Jeu. 21h · Sam. 21h",
      body: "Sélection house & dance orientée Europe — ambiance club international.",
      coverUrl: "assets/dj-red-headphones.webp",
      variant: "oksana",
      sortOrder: 2,
    },
  ];
  const rail = [
    { kind: "rail" as const, tag: "DJ Set", title: "DJ JÜMPOFF — JÜMPOFFproject", body: "Mix club et soirées énergie dance, plusieurs créneaux du mercredi au dimanche.", emoji: "🎚️", sortOrder: 0 },
    { kind: "rail" as const, tag: "Antenne", title: "Hommage Limelight Montréal", body: "DJ Pierre Jutras revient cette semaine avec quatre créneaux signatures.", emoji: "🎙", sortOrder: 1 },
    { kind: "rail" as const, tag: "Émission", title: "Nouvelle saison de Hit Drive", body: "Du lundi au vendredi 16h–18h, l'antenne accélère pour la sortie des bureaux.", emoji: "🚗", sortOrder: 2 },
    { kind: "rail" as const, tag: "Nuit", title: "BeatRadioWorld : Best DJ's internationaux", body: "Tous les soirs 22h–07h, mixes live d'Europe, Amérique, Asie.", emoji: "🌙", sortOrder: 3 },
    { kind: "rail" as const, tag: "Studio", title: "Alain Perron en matinale", body: "Café-actu-musique chaque matin 7h–9h. Appelle au 418-261-2886.", emoji: "☕", sortOrder: 4 },
    { kind: "rail" as const, tag: "Mix", title: "DJ OSKANA — Show européen", body: "Jeudi 21h et samedi 21h pour la house continentale.", emoji: "🎧", sortOrder: 5 },
  ];
  for (const item of [...homepage, ...rail]) {
    await db.insert(featuredItems).values({ ...item, radioId, isPublished: true });
  }
  console.log(`[seed] ${homepage.length + rail.length} éléments « À la une » insérés.`);
}

// Slug local (évite d'importer la version générique pour rester explicite ici).
function slugifyTitle(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function main() {
  console.log("[seed] démarrage…");
  // Sanity : la DB répond ?
  await db.execute(sql`SELECT 1`);

  // Tenant de cette instance (1 radio par déploiement). Tout le contenu + les
  // comptes y sont rattachés via radio_id.
  const radioId = await ensureDefaultRadio();

  // Le superadmin (admin de la radio), le propriétaire En Ondes (god mode) et
  // le compte IT (technique cross-radio) sont toujours garantis (création/
  // promotion idempotente).
  await seedSuperadmin(radioId);
  await seedOwner();
  await seedIt();

  // Le contenu (animateurs / émissions / grille) n'est seedé QUE si la base
  // est vierge. Sur une base déjà peuplée, on ne touche à rien → les éditions
  // faites depuis l'admin sont préservées même si ce script tourne à chaque
  // déploiement (preDeployCommand). Bootstrap une fois, jamais d'écrasement.
  const existing = await db.select({ id: artists.id }).from(artists).limit(1);
  const bundle = loadSeedBundle(env.SEED_BRAND);
  if (existing.length > 0) {
    console.log("[seed] contenu déjà présent — skip animateurs/émissions/grille (éditions admin préservées).");
  } else if (!bundle) {
    // Marque sans seed de départ : la radio démarre vierge et l'équipe saisit
    // ses animateurs / émissions / grille via l'admin.
    console.log(`[seed] marque "${env.SEED_BRAND}" — aucun seed de départ, contenu à saisir via l'admin.`);
  } else {
    console.log(`[seed] marque "${env.SEED_BRAND}" — seed de départ appliqué (éditable ensuite via l'admin).`);
    const artistIdBySlug = await seedArtists(bundle.artists, radioId);
    await seedShows(bundle.shows, artistIdBySlug, radioId);
    await seedSchedule(bundle.schedule, bundle.hostToArtistSlug, artistIdBySlug, radioId);
  }

  // Rattache toute ligne orpheline (prod existante) à la radio de cette instance.
  await backfillRadioId(radioId);

  // « À la une » : seed idempotent (skip si déjà peuplé).
  await seedFeaturedItems(radioId);

  console.log("[seed] terminé ✓");
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed] échec", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
