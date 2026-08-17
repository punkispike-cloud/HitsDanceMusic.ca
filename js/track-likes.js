/* Historique public des titres joués + 🤘 j'aime. Module autonome : à brancher
   sur un conteneur via initTrackHistory("monConteneur"). Lit l'API En Ondes
   (scopée à la radio par l'hôte). Likes anonymes — client_id stable en
   localStorage (le même que presence/analytics). */

import { API_BASE } from "./api-config.js";
import { ensureClientId } from "./client-id.js";

const LS_LIKES = "hr.trackLikes";

export function getLikedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_LIKES) || "[]"));
  } catch {
    return new Set();
  }
}

export function saveLikedSet(set) {
  try {
    localStorage.setItem(LS_LIKES, JSON.stringify([...set]));
  } catch { /* quota */ }
}

export async function fetchRecentTracks(limit = 20) {
  const r = await fetch(`${API_BASE}/v1/tracks/recent?limit=${limit}`, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export async function toggleTrackLike(trackId, liked) {
  const cid = encodeURIComponent(ensureClientId());
  const r = await fetch(`${API_BASE}/v1/tracks/${trackId}/like?clientId=${cid}`, {
    method: liked ? "DELETE" : "POST",
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export function fmtTrackTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function injectStyleOnce() {
  if (document.getElementById("trk-likes-style")) return;
  const s = document.createElement("style");
  s.id = "trk-likes-style";
  s.textContent = `
  .trk-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
  .trk-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.04)}
  .trk-meta{min-width:0}
  .trk-title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .trk-sub{font-size:12px;opacity:.6}
  .trk-like{flex:none;cursor:pointer;border:0;font:inherit;color:inherit;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.06)}
  .trk-like[aria-pressed="true"]{background:rgba(207,155,63,.22)}
  .trk-like:hover{background:rgba(255,255,255,.12)}
  .trk-like[disabled]{opacity:.5}`;
  document.head.appendChild(s);
}

function render(container, tracks) {
  const liked = getLikedSet();
  container.replaceChildren();
  const ul = document.createElement("ul");
  ul.className = "trk-list";

  if (!tracks.length) {
    const li = document.createElement("li");
    li.className = "trk-sub";
    li.textContent = "Aucun titre joué pour l'instant.";
    ul.appendChild(li);
    container.appendChild(ul);
    return;
  }

  for (const t of tracks) {
    const li = document.createElement("li");
    li.className = "trk-item";

    const meta = document.createElement("div");
    meta.className = "trk-meta";
    const title = document.createElement("div");
    title.className = "trk-title";
    title.textContent = t.artist ? `${t.artist} — ${t.title}` : t.title;
    const sub = document.createElement("div");
    sub.className = "trk-sub";
    sub.textContent = fmtTrackTime(t.playedAt);
    meta.append(title, sub);

    const btn = document.createElement("button");
    btn.className = "trk-like";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(liked.has(t.id)));
    btn.setAttribute("aria-label", "J'aime ce titre");
    const count = document.createElement("span");
    count.textContent = String(t.likes ?? 0);
    btn.append(document.createTextNode("🤘 "), count);

    btn.addEventListener("click", async () => {
      const currentlyLiked = btn.getAttribute("aria-pressed") === "true";
      btn.disabled = true;
      try {
        const res = await toggleTrackLike(t.id, currentlyLiked);
        const set = getLikedSet();
        if (res.liked) set.add(t.id);
        else set.delete(t.id);
        saveLikedSet(set);
        btn.setAttribute("aria-pressed", String(res.liked));
        count.textContent = String(res.likes ?? 0);
      } catch { /* réseau */ } finally {
        btn.disabled = false;
      }
    });

    li.append(meta, btn);
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

/** Branche l'historique + likes dans un conteneur (id ou élément). */
export async function initTrackHistory(containerId, opts = {}) {
  const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (!container) return;
  const limit = opts.limit ?? 20;
  injectStyleOnce();
  const refresh = async () => {
    try {
      render(container, await fetchRecentTracks(limit));
    } catch { /* hors-ligne */ }
  };
  await refresh();
  if (opts.pollMs && opts.pollMs > 0) setInterval(refresh, opts.pollMs);
}
