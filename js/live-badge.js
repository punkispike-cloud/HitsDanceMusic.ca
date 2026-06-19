/* Badge « en ondes / à venir ». Greffe additive : ne fait rien tant qu'un
   conteneur #liveBadge n'est pas présent (donc seulement sur les nouvelles
   pages — n'altère AUCUNE page existante). Données : /v1/schedule/now + /v1/schedule. */

import { escapeHtml } from "./util.js";
import { API_BASE } from "./api-config.js";

async function fetchJson(path) {
  try {
    const r = await fetch(`${API_BASE}${path}`, { mode: "cors", cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Jour (0=dim) + minutes depuis minuit, heure de Montréal. */
function montrealNow() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = fmt.formatToParts(new Date());
  const wd = p.find((x) => x.type === "weekday")?.value ?? "Sun";
  const hourRaw = p.find((x) => x.type === "hour")?.value ?? "0";
  const minute = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = hourRaw === "24" ? 0 : Number(hourRaw);
  return { day: map[wd] ?? 0, min: hour * 60 + minute };
}

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Cherche le prochain créneau (aujourd'hui après maintenant, sinon jours suivants). */
function findNext(schedule) {
  const { day, min } = montrealNow();
  for (let off = 0; off < 7; off++) {
    const d = (day + off) % 7;
    const slots = (schedule[String(d)] || []).slice().sort((a, b) => (toMin(a[0]) ?? 0) - (toMin(b[0]) ?? 0));
    for (const s of slots) {
      const from = toMin(s[0]);
      if (from == null) continue;
      if (off === 0 && from <= min) continue;
      return { title: s[2], host: s[3], from: s[0] };
    }
  }
  return null;
}

export async function initLiveBadge() {
  const host = document.querySelector("#liveBadge");
  if (!host) return; // pas de conteneur → no-op (pages existantes intactes)

  const [now, schedule] = await Promise.all([
    fetchJson("/v1/schedule/now"),
    fetchJson("/v1/schedule"),
  ]);

  const parts = [];
  if (now && now.title) {
    parts.push(
      `<span class="live-now"><span class="live-dot" aria-hidden="true"></span>En ondes : <strong>${escapeHtml(now.title)}</strong>${
        now.host ? ` · ${escapeHtml(now.host)}` : ""
      }</span>`,
    );
  }
  if (schedule) {
    const next = findNext(schedule);
    if (next) {
      parts.push(`<span class="live-next">À suivre : <strong>${escapeHtml(next.title)}</strong> · ${escapeHtml(next.from)}</span>`);
    }
  }

  if (!parts.length) { host.hidden = true; return; }
  host.innerHTML = parts.join("");
  host.hidden = false;
}
