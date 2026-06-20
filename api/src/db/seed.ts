/* Seed idempotent : superadmin + animateurs + émissions + grille.
   - Artistes/émissions : upsert par slug.
   - Créneaux : purge + ré-insertion (la grille est un tout cohérent).
   Lancer : `npm run seed`. */

import { eq, sql } from "drizzle-orm";
import { db, pool } from "./client.js";
import { users, artists, shows, scheduleSlots } from "./schema.js";
import { hashPassword } from "../lib/password.js";
import { toMinutes } from "../lib/validation.js";
import { env } from "../env.js";
import type { SeedArtist, SeedShow, ScheduleRow } from "./seed-data.js";
import { loadSeedBundle } from "./seeds.js";

async function seedSuperadmin() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.warn("[seed] SEED_ADMIN_EMAIL/PASSWORD absents — superadmin non créé.");
    return;
  }
  const existing = await db.query.users.findFirst({
    where: eq(users.email, env.SEED_ADMIN_EMAIL),
  });
  if (existing) {
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
  });
  console.log(`[seed] superadmin créé : ${env.SEED_ADMIN_EMAIL}`);
}

async function seedArtists(seedArtistList: SeedArtist[]): Promise<Map<string, string>> {
  const bySlug = new Map<string, string>();
  for (const a of seedArtistList) {
    const [row] = await db
      .insert(artists)
      .values({
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
        target: artists.slug,
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

async function seedShows(seedShowList: SeedShow[], artistIdBySlug: Map<string, string>) {
  for (const s of seedShowList) {
    const slug = slugifyTitle(s.title);
    const artistId = s.artistSlug ? artistIdBySlug.get(s.artistSlug) ?? null : null;
    await db
      .insert(shows)
      .values({
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
        target: shows.slug,
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
) {
  // Index titre d'émission → id (best-effort pour lier les créneaux).
  const showRows = await db.select({ id: shows.id, title: shows.title }).from(shows);
  const showIdByTitle = new Map(showRows.map((r) => [r.title.toLowerCase(), r.id]));

  await db.delete(scheduleSlots);
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

  // Le superadmin est toujours garanti (création idempotente).
  await seedSuperadmin();

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
    const artistIdBySlug = await seedArtists(bundle.artists);
    await seedShows(bundle.shows, artistIdBySlug);
    await seedSchedule(bundle.schedule, bundle.hostToArtistSlug, artistIdBySlug);
  }

  console.log("[seed] terminé ✓");
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed] échec", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
