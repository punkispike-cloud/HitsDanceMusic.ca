/* Pages de partage social (Open Graph / Twitter Card).
   Les robots des réseaux lisent les balises meta ici ; les humains sont
   redirigés vers le site public. Permet de beaux aperçus de liens
   (Facebook, Instagram, iMessage, Slack…) sans toucher au site statique. */

import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { artists, shows, episodes, mixes } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { requireRadioId } from "../services/tenant.js";
import { env } from "../env.js";
import type { AppBindings } from "../types.js";

export const shareRoutes = new Hono<AppBindings>();

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SITE = env.PUBLIC_SITE_URL.replace(/\/$/, "");
const DEFAULT_IMG = `${SITE}/icons/icon-512.png`;

function page(opts: {
  title: string;
  description: string;
  image: string;
  redirect: string;
  type?: string;
}): string {
  const { title, description, image, redirect, type = "website" } = opts;
  return `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="${esc(type)}"/>
<meta property="og:site_name" content="Hits Dance Music"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta property="og:url" content="${esc(redirect)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<meta http-equiv="refresh" content="0; url=${esc(redirect)}"/>
<link rel="canonical" href="${esc(redirect)}"/>
</head><body style="background:#0a0a0a;color:#eee;font-family:Arial,sans-serif;text-align:center;padding:48px">
<p>Redirection vers <a style="color:#ff2d75" href="${esc(redirect)}">${esc(title)}</a>…</p>
<script>location.replace(${JSON.stringify(redirect)});</script>
</body></html>`;
}

function html(c: Context, body: string) {
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(body);
}

shareRoutes.get("/share/artist/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slug = c.req.param("slug");
  const a = await db.query.artists.findFirst({
    where: and(eq(artists.radioId, radioId), eq(artists.slug, slug), eq(artists.isPublished, true)),
  });
  if (!a) throw notFound("Animateur introuvable");
  return html(
    c,
    page({
      title: `${a.name} — Hits Dance Music`,
      description: a.bio || a.showTitle || `Découvre ${a.name} sur Hits Dance Music.`,
      image: a.photoUrl || DEFAULT_IMG,
      redirect: `${SITE}/animateurs.html#${encodeURIComponent(a.slug)}`,
      type: "profile",
    }),
  );
});

shareRoutes.get("/share/show/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slug = c.req.param("slug");
  const s = await db.query.shows.findFirst({
    where: and(eq(shows.radioId, radioId), eq(shows.slug, slug), eq(shows.isPublished, true)),
  });
  if (!s) throw notFound("Émission introuvable");
  return html(
    c,
    page({
      title: `${s.title} — Hits Dance Music`,
      description: s.description || `${s.title}, une émission de Hits Dance Music.`,
      image: DEFAULT_IMG,
      redirect: `${SITE}/emissions.html#${encodeURIComponent(s.slug)}`,
    }),
  );
});

shareRoutes.get("/share/episode/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slug = c.req.param("slug");
  const e = await db.query.episodes.findFirst({
    where: and(eq(episodes.radioId, radioId), eq(episodes.slug, slug), eq(episodes.status, "published")),
  });
  if (!e) throw notFound("Épisode introuvable");
  return html(
    c,
    page({
      title: `${e.title} — Podcast Hits Dance Music`,
      description: e.description || `Écoute "${e.title}" sur Hits Dance Music.`,
      image: e.coverUrl || DEFAULT_IMG,
      redirect: `${SITE}/podcasts.html#${encodeURIComponent(e.slug)}`,
      type: "music.song",
    }),
  );
});

shareRoutes.get("/share/mix/:slug", async (c) => {
  const radioId = requireRadioId(c.get("radioId"));
  const slug = c.req.param("slug");
  const m = await db.query.mixes.findFirst({
    where: and(eq(mixes.radioId, radioId), eq(mixes.slug, slug), eq(mixes.status, "published")),
  });
  if (!m) throw notFound("Mix introuvable");
  return html(
    c,
    page({
      title: `${m.title} — Mix Hits Dance Music`,
      description: m.description || `Écoute le mix "${m.title}"${m.genre ? ` (${m.genre})` : ""} sur Hits Dance Music.`,
      image: m.coverUrl || DEFAULT_IMG,
      redirect: `${SITE}/podcasts.html#${encodeURIComponent(m.slug)}`,
      type: "music.song",
    }),
  );
});
