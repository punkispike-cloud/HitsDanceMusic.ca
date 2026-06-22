"use client";

import { useEffect, useState } from "react";
import type { GeoPoint } from "@/lib/types";

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

  const pts = (points ?? []).filter(
    (p) => typeof p.lat === "number" && typeof p.lon === "number",
  );
  const maxS = Math.max(1, ...pts.map((p) => p.sessions));
  // Liveness calculée côté client à partir de last_seen + `now` (horloge 1 s du
  // parent) → un point s'« éteint » tout seul après 60 s sans nouveau fetch.
  const isLive = (p: GeoPoint) => now - new Date(p.last_seen).getTime() < LIVE_WINDOW_MS;
  const liveSessions = pts.filter(isLive).reduce((a, p) => a + p.sessions, 0);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", background: "#0b1020" }}>
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
            <g key={i}>
              {live && (
                <circle cx={x} cy={y} r={r} fill="#19c37d" opacity={0.3}>
                  <animate attributeName="r" values={`${r};${r + 8};${r}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={x} cy={y} r={r} fill={color} stroke="#ffffff" strokeWidth={0.5} opacity={0.92}>
                <title>{`${p.label ?? "?"} — ${p.sessions} session(s)${live ? " · en direct" : ""}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: "0.8rem",
          color: "#cdd6e8",
          background: "rgba(11,16,32,0.6)",
          padding: "4px 8px",
          borderRadius: 6,
        }}
      >
        <strong style={{ color: "#19c37d" }}>● {liveSessions}</strong> en direct ·{" "}
        {pts.length} ville{pts.length > 1 ? "s" : ""}
        {!world && <span style={{ color: "#8a96b0" }}> · (fond de carte indisponible)</span>}
      </div>
    </div>
  );
}
