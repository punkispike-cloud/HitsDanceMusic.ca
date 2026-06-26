/* Historique public des titres joués + 🤘 j'aime. Module autonome : à brancher
   sur un conteneur via initTrackHistory("monConteneur"). Lit l'API En Ondes
   (scopée à la radio par l'hôte). Likes anonymes — client_id stable en
   localStorage (le même que presence/analytics). Construit le DOM sans innerHTML
   (les titres viennent du flux : on évite toute injection). */

import { API_BASE } from "./api-config.js";

const LS_CLIENT = "hr.clientId";
const LS_LIKES = "hr.trackLikes";

function getClientId() {
  try {
    let id = localStorage.getItem(LS_CLIENT);
    if (!id) {
      id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(LS_CLIENT, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

function likedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_LIKES) || "[]"));
  } catch {
    return new Set();
  }
}
function saveLiked(set) {
  try {
    localStorage.setItem(LS_LIKES, JSON.stringify([...set]));
  } catch {
    /* quota / mode privé → on ignore */
  }
}

async function fetchRecent(limit) {
  const r = await fetch(`${API_BASE}/v1/tracks/recent?limit=${limit}`, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function toggleLike(trackId, liked) {
  const cid = encodeURIComponent(getClientId());
  const r = await fetch(`${API_BASE}/v1/tracks/${trackId}/like?clientId=${cid}`, {
    method: liked ? "DELETE" : "POST",
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json(); // { liked, likes }
}

function fmtTime(iso) {
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
  const liked = likedSet();
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
    sub.textContent = fmtTime(t.playedAt);
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
        const res = await toggleLike(t.id, currentlyLiked);
        const set = likedSet();
        if (res.liked) set.add(t.id);
        else set.delete(t.id);
        saveLiked(set);
        btn.setAttribute("aria-pressed", String(res.liked));
        count.textContent = String(res.likes ?? 0);
      } catch {
        /* réseau / rate-limit → on laisse l'état inchangé */
      } finally {
        btn.disabled = false;
      }
    });

    li.append(meta, btn);
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

/** Branche l'historique + likes dans un conteneur (id ou élément).
    opts: { limit = 20, pollMs } — pollMs > 0 rafraîchit en continu. */
export async function initTrackHistory(containerId, opts = {}) {
  const container = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (!container) return;
  const limit = opts.limit ?? 20;
  injectStyleOnce();
  const refresh = async () => {
    try {
      render(container, await fetchRecent(limit));
    } catch {
      /* hors-ligne / API absente → on laisse le conteneur tel quel */
    }
  };
  await refresh();
  if (opts.pollMs && opts.pollMs > 0) setInterval(refresh, opts.pollMs);
}
