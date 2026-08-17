/* Résolution du fichier MMDB pour la géo-IP locale.
   Lookup = fichier local uniquement (aucun IP visiteur n'est envoyé à un tiers).
   Si GEOIP_DB_PATH pointe vers un .mmdb existant, on l'utilise.
   Sinon, en prod/staging, on télécharge DB-IP City Lite (CC-BY, attribution
   « IP Geolocation by DB-IP ») dans /tmp. Désactiver : GEOIP_DISABLED=1. */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const CACHE_PATH = "/tmp/geoip-city.mmdb";

export function dbipLiteUrl(d = new Date()): string {
  const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `https://download.db-ip.com/free/dbip-city-lite-${stamp}.mmdb.gz`;
}

async function downloadMmdb(url: string): Promise<Buffer> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const gz = Buffer.from(await r.arrayBuffer());
  return gunzipSync(gz);
}

/** Télécharge le millésime du mois, sinon celui du mois précédent. */
export async function downloadDbipLite(): Promise<Buffer> {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  try {
    return await downloadMmdb(dbipLiteUrl(now));
  } catch (err) {
    console.warn("[geo] millésime courant indisponible, essai mois précédent", err);
    return await downloadMmdb(dbipLiteUrl(prev));
  }
}

/** Chemin du .mmdb à ouvrir. Télécharge dans /tmp si besoin. */
export async function resolveGeoMmdbPath(): Promise<string | null> {
  const pinned = process.env.GEOIP_DB_PATH?.trim();
  if (pinned && existsSync(pinned)) return pinned;
  if (existsSync(CACHE_PATH)) return CACHE_PATH;
  try {
    const buf = await downloadDbipLite();
    if (buf.length < 10_000) throw new Error(`fichier MMDB trop petit (${buf.length} o)`);
    await writeFile(CACHE_PATH, buf);
    console.log(`[geo] DB-IP City Lite chargé (${(buf.length / 1_048_576).toFixed(1)} Mo) — IP Geolocation by DB-IP`);
    return CACHE_PATH;
  } catch (err) {
    console.error("[geo] téléchargement DB-IP City Lite échoué — géo désactivée", err);
    return null;
  }
}
