/* Flux RSS podcast (compatible Apple Podcasts / Spotify).
   GET /v1/rss/:showSlug → XML iTunes des épisodes publiés d'une émission.
   Public, lecture seule. Différenciateur : aucune radio QC comparable
   n'expose proprement ses podcasts en RSS. */

import { Hono } from "hono";
import { eq, and, asc, desc, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { shows, episodes, artists } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { requireRadioId } from "../services/tenant.js";
import { env } from "../env.js";
import type { AppBindings } from "../types.js";

export const rssRoutes = new Hono<AppBindings>();

/** Échappe le texte pour insertion dans du XML. */
function xml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Durée en secondes → "HH:MM:SS" (format iTunes). */
function hhmmss(total: number | null | undefined): string {
  const t = Math.max(0, Math.floor(total ?? 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* GET /v1/rss/:showSlug */
rssRoutes.get("/rss/:showSlug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slug = c.req.param("showSlug");
  const show = await db.query.shows.findFirst({
    where: and(eq(shows.radioId, radioId), eq(shows.slug, slug), eq(shows.isPublished, true)),
  });
  if (!show) throw notFound("Émission introuvable");

  const owner = show.artistId
    ? await db.query.artists.findFirst({ where: eq(artists.id, show.artistId) })
    : null;

  // Épisodes publiés rattachés à l'émission ET possédant un fichier audio.
  const rows = await db
    .select()
    .from(episodes)
    .where(
      and(
        eq(episodes.radioId, radioId),
        eq(episodes.showId, show.id),
        eq(episodes.status, "published"),
        isNotNull(episodes.audioUrl),
      ),
    )
    .orderBy(desc(episodes.publishedAt), asc(episodes.episodeNumber));

  const site = env.PUBLIC_SITE_URL;
  const feedUrl = `${site.replace(/\/$/, "")}/`;
  const author = owner?.name || "Hits Dance Music";
  const showCover = owner?.photoUrl || `${site.replace(/\/$/, "")}/icons/icon-512.png`;

  const items = rows
    .map((e) => {
      const url = e.audioUrl!;
      const guid = `${site}/podcasts/${e.slug}`;
      const pub = (e.publishedAt ?? e.createdAt).toUTCString();
      const len = e.sizeBytes ?? 0;
      return `    <item>
      <title>${xml(e.title)}</title>
      <description>${xml(e.description)}</description>
      <itunes:summary>${xml(e.description)}</itunes:summary>
      <enclosure url="${xml(url)}" length="${len}" type="audio/mpeg"/>
      <guid isPermaLink="false">${xml(guid)}</guid>
      <pubDate>${pub}</pubDate>
      <itunes:author>${xml(author)}</itunes:author>
      <itunes:duration>${hhmmss(e.durationSec)}</itunes:duration>${
        e.episodeNumber ? `\n      <itunes:episode>${e.episodeNumber}</itunes:episode>` : ""
      }${e.season ? `\n      <itunes:season>${e.season}</itunes:season>` : ""}
    </item>`;
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xml(show.title)}</title>
    <link>${xml(feedUrl)}</link>
    <language>fr-ca</language>
    <description>${xml(show.description) || xml(show.title)}</description>
    <itunes:author>${xml(author)}</itunes:author>
    <itunes:summary>${xml(show.description) || xml(show.title)}</itunes:summary>
    <itunes:owner>
      <itunes:name>${xml(author)}</itunes:name>
    </itunes:owner>
    <itunes:image href="${xml(showCover)}"/>
    <itunes:category text="Music"/>
    <itunes:explicit>false</itunes:explicit>
${items}
  </channel>
</rss>`;

  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(feed);
});
