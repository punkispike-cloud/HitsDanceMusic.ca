"use client";

/* Petite courbe de tendance (SVG, aucune dépendance). Aire + ligne, responsive.
   Utilisée par la console opérateur (Parc + page détail d'une radio). */

export interface TrendPoint {
  day: string;
  value: number;
}

export function TrendChart({ points, color = "#3aa0ff", height = 150, label = "Tendance" }: { points: TrendPoint[]; color?: string; height?: number; label?: string }) {
  if (!points.length) return <div style={{ color: "var(--txt-dim)", fontSize: 13 }}>Pas encore de données.</div>;

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

  // Résumé textuel de la tendance pour les lecteurs d'écran.
  const startVal = points[0]!.value;
  const endVal = points[n - 1]!.value;
  const dir = endVal > startVal ? "en hausse" : endVal < startVal ? "en baisse" : "stable";
  const summary = `${label} sur ${n} jours, ${dir}. Du ${first} (${startVal.toLocaleString("fr-CA")}) au ${last} (${endVal.toLocaleString("fr-CA")}). Total ${total.toLocaleString("fr-CA")}, maximum ${max.toLocaleString("fr-CA")} par jour.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={summary}>
        <defs>
          <linearGradient id="tc-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#tc-grad)" />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {/* Alternative tabulaire réservée aux lecteurs d'écran. */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr><th scope="col">Jour</th><th scope="col">Valeur</th></tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}><td>{p.day}</td><td>{p.value.toLocaleString("fr-CA")}</td></tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--txt-dim)", marginTop: 2 }} aria-hidden="true">
        <span>{first}</span>
        <span>total : {total.toLocaleString("fr-CA")} · max/j : {max.toLocaleString("fr-CA")}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}
