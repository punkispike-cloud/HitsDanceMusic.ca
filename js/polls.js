/* Widget « sondage en direct » : récupère le sondage actif de la radio
   (GET /v1/polls/active) et permet à l'auditeur de voter (POST /v1/polls/:id/vote).
   Réutilise le même clientId stable que presence/analytics/contact-form
   (localStorage hr.clientId). S'auto-masque quand aucun sondage n'est actif.
   No-op si le conteneur #pollWidget est absent de la page.

   Confidentialité : le rafraîchissement est AUTOMATIQUE → il n'envoie le
   clientId que s'il existe déjà (getClientId), sans jamais en créer. Seul le
   vote — action déclenchée par la personne — en crée un au besoin
   (ensureClientId), car le dédoublonnage des votes en dépend. */

import { $, escapeHtml, fetchWithTimeout, NET_TIMEOUTS } from "./util.js";
import { toast } from "./toast.js";
import { API_BASE } from "./api-config.js";
import { getClientId, ensureClientId } from "./client-id.js";

const POLL_MS = 5000;  // rafraîchissement quand un sondage est actif
const IDLE_MS = 20000; // re-détection d'un nouveau sondage quand aucun n'est actif

export function initPolls() {
  const host = $("#pollWidget");
  if (!host) return; // conteneur absent → no-op sur cette page

  let currentId = null;
  let voting = false;
  let timer = 0;

  function render(poll) {
    if (!poll) {
      host.hidden = true;
      host.innerHTML = "";
      currentId = null;
      return;
    }
    currentId = poll.id;
    const total = poll.totalVotes || 0;
    const max = Math.max(1, ...poll.results.map((r) => r.count));
    const voted = poll.myVote != null;

    const opts = poll.results
      .map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        const barW = Math.round((r.count / max) * 100);
        const mine = poll.myVote === r.optionIndex;
        const btnStyle = [
          "display:flex",
          "align-items:center",
          "gap:10px",
          "width:100%",
          "padding:8px 10px",
          "border:1px solid var(--line,#333)",
          "border-radius:8px",
          "background:var(--panel,#1b1b22)",
          "color:var(--txt,#eee)",
          "cursor:" + (voted ? "default" : "pointer"),
          "text-align:left",
          mine ? "border-color:var(--accent,#c8102e);box-shadow:0 0 0 1px var(--accent,#c8102e) inset" : "",
        ].join(";");
        return `<button type="button" class="poll-opt" data-idx="${r.optionIndex}"${voted ? " disabled" : ""} style="${btnStyle}">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.92rem">${escapeHtml(r.label)}</span>
          <span aria-hidden="true" style="width:120px;height:7px;border-radius:4px;background:var(--panel-2,#2a2a33);overflow:hidden">
            <span style="display:block;height:100%;width:${barW}%;background:var(--accent,#c8102e);border-radius:4px;min-width:${r.count ? 3 : 0}px"></span>
          </span>
          <span style="font-variant-numeric:tabular-nums;font-size:0.82rem;width:66px;text-align:right">${r.count}${total ? ` <span style="opacity:.6">· ${pct}%</span>` : ""}</span>
        </button>`;
      })
      .join("");

    host.innerHTML = `<div style="max-width:560px;margin:14px auto 0;padding:14px 16px;border:1px solid var(--line,#333);border-radius:14px;background:var(--panel,#15151c)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:0.68rem;font-weight:800;letter-spacing:.08em;padding:3px 8px;border-radius:10px;background:var(--accent,#c8102e);color:#fff">SONDAGE</span>
        <span style="font-size:0.74rem;opacity:.6">en direct</span>
      </div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:12px">${escapeHtml(poll.question)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">${opts}</div>
      <div style="margin-top:10px;font-size:0.78rem;opacity:.6">${total} vote${total > 1 ? "s" : ""}${voted ? " · merci pour ton vote" : " · choisis une option"}</div>
    </div>`;
    host.hidden = false;

    if (!voted) {
      host.querySelectorAll(".poll-opt").forEach((btn) => {
        btn.addEventListener("click", () => { void vote(poll.id, Number(btn.dataset.idx)); });
      });
    }
  }

  async function vote(pollId, optionIndex) {
    if (voting || pollId !== currentId) return;
    voting = true;
    try {
      const r = await fetchWithTimeout(`${API_BASE}/v1/polls/${pollId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: ensureClientId(), optionIndex }),
      }, NET_TIMEOUTS.generic);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast("Vote enregistré ✓", "ok");
      await refresh();
    } catch {
      toast("Vote impossible — réessaie", "warn");
    } finally {
      voting = false;
    }
  }

  async function refresh() {
    try {
      // Lecture seule : pas de création d'identifiant. `clientId` est optionnel
      // côté API (il ne sert qu'à renvoyer `myVote`).
      const clientId = getClientId();
      const url = clientId
        ? `${API_BASE}/v1/polls/active?clientId=${encodeURIComponent(clientId)}`
        : `${API_BASE}/v1/polls/active`;
      const r = await fetchWithTimeout(url, {}, NET_TIMEOUTS.generic);
      if (!r.ok) { host.hidden = true; return null; }
      const poll = await r.json();
      render(poll);
      return poll;
    } catch {
      // API injoignable : on garde l'état courant (pas de flash).
      return null;
    }
  }

  async function tick() {
    const poll = await refresh();
    schedule(poll && poll.id ? POLL_MS : IDLE_MS);
  }
  function schedule(ms) {
    clearTimeout(timer);
    timer = window.setTimeout(tick, ms);
  }

  // Rafraîchit immédiatement au retour sur l'onglet.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { clearTimeout(timer); void tick(); }
  });

  void tick();
}
