"use client";

/* Petite courbe de tendance (SVG, aucune dépendance). Aire + ligne, responsive.
   Utilisée par la console opérateur (Parc + page détail d'une radio). */

export interface TrendPoint {
  day: string;
  value: number;
}

export function TrendChart({ points, color = "#3aa0ff", height = 150 }: { points: TrendPoint[]; color?: string; height?: number }) {
  if (!points.length) return <div style={{ color: "#778", fontSize: 13 }}>Pas encore de données.</div>;

  const W = 720;
  const H = height;
  const PAD = 10;
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const dx = (W - 2 * PAD) / Math.max(1, n - 1);
  const xy = points.map((p, i) => {
    const x = PAD + i * dx;
    const y = H - PAD - (p.value / max) * (H - 2 * PAD - 14);
    return [x, y] as const;
  });
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${xy[n - 1]![0].toFixed(1)} ${H - PAD} L ${xy[0]![0].toFixed(1)} ${H - PAD} Z`;
  const total = points.reduce((s, p) => s + p.value, 0);
  const first = points[0]!.day.slice(5);
  const last = points[n - 1]!.day.slice(5);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Courbe de tendance">
        <defs>
          <linearGradient id="tc-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#tc-grad)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#778", marginTop: 2 }}>
        <span>{first}</span>
        <span>total : {total.toLocaleString("fr-CA")} · max/j : {max.toLocaleString("fr-CA")}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}
