"use client";

import { useEffect, useState } from "react";
import type { GeoPoint } from "@/lib/types";

/* Respecte prefers-reduced-motion. Le SMIL <animate> ne s'arrête PAS via CSS :
   on doit donc conditionner son rendu en JS (montage conditionnel). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* Carte des visiteurs — SVG autonome (aucune librairie de carte).
   Fond : GeoJSON mondial léger (jsDelivr, CORS *). Projection équirectangulaire.
   Les points pulsent en vert quand le visiteur est actif (« en direct »). */

const GEO_URL = "https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json";
const W = 1000;
const H = 500;
const LIVE_WINDOW_MS = 60_000; // un point « en direct » = vu il y a moins de 60 s

const projX = (lon: number) => ((lon + 180) / 360) * W;
const projY = (lat: number) => ((90 - lat) / 180) * H;

type Position = [number, number];
interface Geometry {
  type: string;
  coordinates?: Position[][] | Position[][][];
}
interface Feature {
  geometry?: Geometry | null;
}
interface FeatureCollection {
  features?: Feature[];
}

// Mémoïsé au niveau module : le fond n'est calculé/téléchargé qu'une fois.
let worldCache: string[] | null = null;

function ringToPath(ring: Position[]): string {
  let d = "";
  ring.forEach(([lon, lat], i) => {
    d += (i === 0 ? "M" : "L") + projX(lon).toFixed(1) + " " + projY(lat).toFixed(1);
  });
  return d + "Z";
}

function geojsonToPaths(fc: FeatureCollection): string[] {
  const paths: string[] = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      paths.push((g.coordinates as Position[][]).map(ringToPath).join(""));
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates as Position[][][]) {
        paths.push(poly.map(ringToPath).join(""));
      }
    }
  }
  return paths;
}

export default function VisitorMap({ points, now }: { points: GeoPoint[] | null; now: number }) {
  const [world, setWorld] = useState<string[] | null>(worldCache);

  useEffect(() => {
    if (worldCache) {
      setWorld(worldCache);
      return;
    }
    let alive = true;
    fetch(GEO_URL)
      .then((r) => r.json())
      .then((fc: FeatureCollection) => {
        worldCache = geojsonToPaths(fc);
        if (alive) setWorld(worldCache);
      })
      .catch(() => {
        /* pas de fond de carte → on affiche quand même les points */
      });
    return () => {
      alive = false;
    };
  }, []);

  const reduced = usePrefersReducedMotion();
  const pts = (points ?? []).filter(
    (p) => typeof p.lat === "number" && typeof p.lon === "number",
  );
  const maxS = Math.max(1, ...pts.map((p) => p.sessions));
  // Liveness visuelle calculée côté client à partir de last_seen + `now` (horloge
  // 1 s du parent) → un point s'« éteint » tout seul après 60 s même si le flux
  // SSE reste silencieux (aucun beacon → aucun push serveur).
  const isLive = (p: GeoPoint) => now - new Date(p.last_seen).getTime() < LIVE_WINDOW_MS;
  // Compteur EXACT du direct : somme de `live_sessions` (calculé côté serveur avec
  // le même prédicat que /overview) → cohérent avec la carte KPI « En direct ».
  // On ne somme PLUS `sessions` (historique total du bucket) — c'était la cause de
  // l'écart « carte = 4, KPI = 1 » : une ville avec 4 sessions historiques dont 1
  // active gonflait la légende à 4.
  const liveSessions = pts.reduce((a, p) => a + (p.live_sessions ?? 0), 0);
  const liveCities = pts.filter((p) => p.live_sessions > 0).length;

  // Résumé synthétique de la carte pour les lecteurs d'écran (role=img).
  const mapSummary = pts.length
    ? `Carte des visiteurs : ${pts.length} ville(s), ${liveCities} en direct totalisant ${liveSessions} visiteur(s) en direct.`
    : "Carte des visiteurs : aucune ville à afficher.";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={mapSummary}
        style={{ display: "block", background: "#0b1020" }}
      >
        {world?.map((d, i) => (
          <path key={i} d={d} fill="#1b2740" stroke="#2b3c5e" strokeWidth={0.4} />
        ))}
        {pts.map((p, i) => {
          const x = projX(p.lon);
          const y = projY(p.lat);
          const r = 2.5 + (p.sessions / maxS) * 6;
          const live = isLive(p);
          const color = live ? "#19c37d" : "#5b8cff";
          return (
            <g key={`${p.label ?? "?"}-${p.lat}-${p.lon}`}>
              {/* Halo animé : monté UNIQUEMENT si l'utilisateur n'a pas demandé
                  de réduire les animations (le SMIL ne s'arrête pas via CSS). */}
              {live && !reduced && (
                <circle cx={x} cy={y} r={r} fill="#19c37d" opacity={0.3}>
                  <animate attributeName="r" values={`${r};${r + 8};${r}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Repli sobre quand reduced-motion : halo statique, sans <animate>. */}
              {live && reduced && (
                <circle cx={x} cy={y} r={r + 3} fill="#19c37d" opacity={0.22} />
              )}
              <circle cx={x} cy={y} r={r} fill={color} stroke="#ffffff" strokeWidth={0.5} opacity={0.92}>
                <title>{`${p.label ?? "?"} — ${p.sessions} visiteur(s)${live ? ` · ${p.live_sessions} en direct` : ""}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      {/* Alternative tabulaire réservée aux lecteurs d'écran. */}
      <table className="sr-only">
        <caption>Visiteurs par ville</caption>
        <thead>
          <tr>
            <th scope="col">Ville</th>
            <th scope="col">Visiteurs</th>
            <th scope="col">État</th>
          </tr>
        </thead>
        <tbody>
          {pts.map((p) => (
            <tr key={`${p.label ?? "?"}-${p.lat}-${p.lon}`}>
              <th scope="row">{p.label ?? "?"}</th>
              <td>{p.sessions}</td>
              <td>{p.live_sessions > 0 ? `${p.live_sessions} en direct` : "récent"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: "0.8rem",
          color: "#e6ecfa",
          background: "rgba(11,16,32,0.78)",
          padding: "6px 10px",
          borderRadius: 6,
          lineHeight: 1.5,
        }}
      >
        {/* Légende : pastille + opacité + texte (l'info n'est pas portée par la
            seule couleur). « En direct » = pleine opacité, « récent » = atténué. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: "#19c37d", opacity: 1, display: "inline-block" }} />
          <strong style={{ color: "#19c37d" }}>{liveSessions}</strong> en direct
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.85 }}>
          <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: "#5b8cff", opacity: 0.6, display: "inline-block" }} />
          {pts.length} ville{pts.length > 1 ? "s" : ""} (récentes)
        </div>
        {!world && <div style={{ color: "#9fb0d0" }}>fond de carte indisponible</div>}
      </div>
    </div>
  );
}
