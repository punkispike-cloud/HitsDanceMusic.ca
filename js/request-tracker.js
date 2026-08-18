/* Suivi des demandes de titres déposées via le formulaire contact.
   Stocke les IDs localement et interroge GET /v1/requests/mine. */

import { API_BASE } from "./api-config.js";
import { ensureClientId } from "./client-id.js";
import { escapeHtml } from "./util.js";

const LS_KEY = "hr.myRequests";

const STATUS_LABEL = {
  new: "En attente",
  read: "Lue au studio",
  queued: "En file",
  played: "Jouée ✓",
  ignored: "Non retenue",
};

export function rememberRequestId(id) {
  if (!id) return;
  try {
    const set = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
    set.add(id);
    localStorage.setItem(LS_KEY, JSON.stringify([...set].slice(-30)));
  } catch { /* quota */ }
}

async function fetchMine() {
  const clientId = ensureClientId();
  if (!clientId) return [];
  const r = await fetch(`${API_BASE}/v1/requests/mine?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
  if (!r.ok) return [];
  return r.json();
}

function renderPanel(listEl, items) {
  if (!items.length) {
    listEl.innerHTML = `<p class="req-empty muted">Aucune demande pour l'instant. Envoie une demande de titre via le formulaire.</p>`;
    return;
  }
  listEl.innerHTML = items.map((req) => {
    const label = req.artist ? `${escapeHtml(req.artist)} — ${escapeHtml(req.title)}` : escapeHtml(req.title);
    const when = new Date(req.createdAt).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" });
    const st = STATUS_LABEL[req.status] || req.status;
    return `<article class="req-card" data-id="${escapeHtml(req.id)}">
      <div class="req-card-head">
        <strong>${label}</strong>
        <span class="req-status req-status--${escapeHtml(req.status)}" aria-label="Statut : ${escapeHtml(st)}">${escapeHtml(st)}</span>
      </div>
      ${req.dedication ? `<p class="req-dedic">${escapeHtml(req.dedication)}</p>` : ""}
      <time class="req-time" datetime="${escapeHtml(req.createdAt)}">${when}</time>
    </article>`;
  }).join("");
}

export async function refreshRequestTracker() {
  const list = document.getElementById("myRequestsList");
  if (!list) return;
  list.setAttribute("aria-busy", "true");
  try {
    renderPanel(list, await fetchMine());
  } catch {
    list.innerHTML = `<p class="req-empty muted">Impossible de charger tes demandes pour l'instant.</p>`;
  } finally {
    list.removeAttribute("aria-busy");
  }
}

export function initRequestTracker() {
  const panel = document.getElementById("myRequestsPanel");
  if (!panel) return;
  const refreshBtn = document.getElementById("myRequestsRefresh");
  refreshBtn?.addEventListener("click", () => void refreshRequestTracker());
  void refreshRequestTracker();
  setInterval(() => void refreshRequestTracker(), 30_000);
}
