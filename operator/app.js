/* Cockpit opérateur — récupère /api/parc et fait le rendu (KPIs + tableau).
   Aucune écriture : tout est en lecture seule, les actions sont des liens. */

const REFRESH_MS = 30_000;

const $ = (sel) => document.querySelector(sel);

/* Icônes SVG inline (currentColor, 24x24, stroke 1.75) — L6.
   Remplacent les emojis tout en gardant le libellé texte à côté. */
const ICONS = {
  up: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  down: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  prov: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  paused: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
  warn: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  ok: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  bad: '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  copy: '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};

/* Annonce un message transitoire aux lecteurs d'écran (région role=status). */
function announce(msg) {
  const live = $("#announce");
  if (live) live.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-CA", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return escapeHtml(iso);
  }
}

/* État de cycle de vie + santé → badge. */
function stateBadge(c) {
  if (c.status === "provisioning") return `<span class="badge badge-prov">${ICONS.prov} En cours</span>`;
  if (c.status === "paused") return `<span class="badge badge-paused">${ICONS.paused} En pause</span>`;
  if (c.status !== "active") return `<span class="badge">${escapeHtml(c.status || "—")}</span>`;
  if (!c.health) return `<span class="badge">—</span>`;
  return c.health.up
    ? `<span class="badge badge-up">${ICONS.up} UP</span>`
    : `<span class="badge badge-down">${ICONS.down} DOWN</span>`;
}

function dbCell(c) {
  if (c.status !== "active" || !c.health) return "—";
  if (!c.health.up) return "—";
  return c.health.db
    ? `<span class="ok">${ICONS.ok} ok</span>`
    : `<span class="bad">${ICONS.bad} <span class="sr-only">échec</span></span>`;
}

function latencyCell(c) {
  if (c.status !== "active" || !c.health || !c.health.up) return "—";
  const ms = c.health.ms;
  const cls = ms < 400 ? "lat-good" : ms < 1200 ? "lat-mid" : "lat-bad";
  /* Qualité non portée par la seule couleur : title + aria-label — L6. */
  const qual = ms < 400 ? "bonne latence" : ms < 1200 ? "latence moyenne" : "latence élevée";
  return `<span class="${cls}" title="${qual}" aria-label="${ms} ms, ${qual}">${ms} ms</span>`;
}

function licenseCell(c) {
  return c.licenses?.attested
    ? `<span class="ok" title="${escapeHtml(c.licenses?.note || "")}">${ICONS.ok} attestées</span>`
    : `<span class="warn" title="${escapeHtml(c.licenses?.note || "")}">${ICONS.warn} à confirmer</span>`;
}

function actionsCell(c) {
  const d = c.domains || {};
  const link = (href, label, title) =>
    href
      ? `<a class="act" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${title}">${label}</a>`
      : `<span class="act act-off" title="domaine non renseigné">${label}</span>`;
  const statsHref = d.admin ? `${d.admin.replace(/\/$/, "")}/statistiques` : "";
  const verifyCmd = d.api ? `node scripts/verify-deploy.mjs ${d.api}` : "";
  const items = [
    link(d.site, "Site", "Ouvrir le site"),
    link(d.admin, "Admin", "Ouvrir l'admin"),
    link(statsHref, "Stats", "Ouvrir les statistiques"),
    verifyCmd
      ? `<button class="act act-copy" type="button" data-copy="${escapeHtml(verifyCmd)}" title="Copier la commande verify-deploy">${ICONS.copy} Vérifier</button>`
      : `<span class="act act-off">Vérifier</span>`,
  ];
  return `<span class="act-row">${items.join("")}</span>`;
}

function renderKpis(k) {
  const cards = [
    { label: "Radios", value: k.total, cls: "" },
    { label: `${ICONS.up} En ligne`, value: k.up, cls: "kpi-up" },
    { label: `${ICONS.down} Hors ligne`, value: k.down, cls: k.down ? "kpi-down" : "" },
    { label: `${ICONS.warn} Licences à confirmer`, value: k.licencesAConfirmer, cls: k.licencesAConfirmer ? "kpi-warn" : "" },
  ];
  if (typeof k.mrr === "number") {
    cards.push({ label: "Revenu mensuel", value: `${k.mrr.toLocaleString("fr-CA")} $`, cls: "kpi-mrr" });
  }
  $("#kpis").innerHTML = cards
    .map((c) => `<div class="kpi ${c.cls}"><div class="kpi-value">${escapeHtml(c.value)}</div><div class="kpi-label">${c.label}</div></div>`)
    .join("");
}

/* Squelette KPI à hauteur réservée (évite le CLS au 1er chargement) — L6. */
function renderKpiSkeleton() {
  const host = $("#kpis");
  if (host.querySelector(".kpi-value") || host.querySelector(".kpi-skeleton")) return;
  host.innerHTML = Array.from({ length: 4 })
    .map(() => `<div class="kpi kpi-skeleton" aria-hidden="true"><div class="kpi-value"></div><div class="kpi-label"></div></div>`)
    .join("");
}

/* Dernier jeu de clients reçu (pour re-trier sans refetch) — L6. */
let lastClients = [];
let sortDir = "down-first"; // tri par défaut : DOWN d'abord puis latence décroissante

/* Rang d'état pour le tri : DOWN (0) avant le reste. */
function stateRank(c) {
  if (c.status === "active" && c.health && !c.health.up) return 0; // DOWN
  return 1;
}
function latencyValue(c) {
  if (c.status !== "active" || !c.health || !c.health.up) return -1;
  return typeof c.health.ms === "number" ? c.health.ms : -1;
}

/* Tri : DOWN d'abord, puis latence décroissante. */
function sortClients(clients) {
  return [...clients].sort((a, b) => {
    const ra = stateRank(a), rb = stateRank(b);
    if (ra !== rb) return ra - rb;
    return latencyValue(b) - latencyValue(a);
  });
}

function rowHtml(c) {
  return `<tr>
        <td class="radio-name"><b>${escapeHtml(c.name)}</b>${c.role ? `<span class="role">${escapeHtml(c.role)}</span>` : ""}</td>
        <td>${stateBadge(c)}</td>
        <td>${dbCell(c)}</td>
        <td>${latencyCell(c)}</td>
        <td>${escapeHtml(c.tier || "—")}</td>
        <td>${licenseCell(c)}</td>
        <td>${fmtDate(c.commissioned)}</td>
        <td class="actions">${actionsCell(c)}</td>
      </tr>`;
}

function renderTable(clients) {
  lastClients = clients || [];
  const body = $("#parcBody");

  if (!lastClients.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">Aucune radio dans le registre.</td></tr>`;
    $("#parcCount").textContent = "0 radio";
    updateParcLive(lastClients);
    return;
  }

  const rows = sortClients(lastClients);
  /* MAJ ciblée : on ne reconstruit le tbody que si la structure change,
     afin de préserver le focus clavier pendant le polling — L6. */
  const next = rows.map(rowHtml).join("");
  if (body.innerHTML !== next) body.innerHTML = next;

  $("#parcCount").textContent = `${lastClients.length} radio(s)`;
  updateParcLive(lastClients);
}

/* Région résumé sr-only « N en ligne, M hors ligne » — L2. */
function updateParcLive(clients) {
  const live = $("#parcLive");
  if (!live) return;
  const up = clients.filter((c) => c.status === "active" && c.health && c.health.up).length;
  const down = clients.filter((c) => c.status === "active" && c.health && !c.health.up).length;
  live.textContent = `${up} en ligne, ${down} hors ligne.`;
}

let firstLoadDone = false; // pour distinguer le 1er chargement raté

/* Affiche l'état « erreur » sans masquer la cause (1er chargement vs périmé) — L3. */
function showError() {
  $("#lastUpdate").textContent = "Erreur de chargement";
  $("#lastUpdate").classList.add("is-stale");
  if (!firstLoadDone) {
    // 1er chargement raté : on ne reste pas bloqué sur « Chargement… ».
    $("#parcBody").innerHTML =
      `<tr><td colspan="8" class="muted">Impossible de charger le parc.` +
      `<button type="button" class="retry-btn" id="retryBtn">Réessayer</button></td></tr>`;
    const rb = $("#retryBtn");
    if (rb) rb.addEventListener("click", refresh);
  } else {
    // Données déjà présentes : on les marque périmées au lieu de les effacer.
    $("#parc-panel").classList.add("is-stale-data");
    $("#staleBanner").classList.add("is-visible");
  }
}

/* Retour à l'état normal au succès — L3. */
function clearError() {
  $("#lastUpdate").classList.remove("is-stale");
  $("#parc-panel").classList.remove("is-stale-data");
  $("#staleBanner").classList.remove("is-visible");
}

async function refresh() {
  const btn = $("#refreshBtn");
  const panel = $("#parc-panel");
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  panel.classList.add("is-loading");
  panel.setAttribute("aria-busy", "true");
  if (!firstLoadDone) renderKpiSkeleton();
  try {
    const r = await fetch("/api/parc", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parc = await r.json();
    renderKpis(parc.kpis);
    renderTable(parc.clients);
    $("#lastUpdate").textContent = `MAJ ${new Date().toLocaleTimeString("fr-CA")}`;
    clearError();
    firstLoadDone = true;
  } catch (err) {
    console.error("[operator] échec du chargement du parc :", err);
    showError();
  } finally {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    panel.classList.remove("is-loading");
    panel.removeAttribute("aria-busy");
  }
}

document.addEventListener("click", (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (!copyBtn) return;
  const cmd = copyBtn.getAttribute("data-copy");
  /* Garde le label texte « Vérifier » + l'icône ; on ne touche qu'au statut. */
  const flash = (txt) => {
    const old = copyBtn.innerHTML;
    copyBtn.textContent = txt;
    setTimeout(() => { copyBtn.innerHTML = old; }, 1400);
  };
  if (!navigator.clipboard?.writeText) {
    flash("Copie indisponible");
    announce("Copie indisponible");
    return;
  }
  navigator.clipboard.writeText(cmd)
    .then(() => { flash("Copié ✓"); announce("Commande copiée"); })
    .catch(() => { flash("Copie indisponible"); announce("Copie indisponible"); });
});

/* Tri au clic / clavier sur les en-têtes triables — L6. */
function applySort() {
  const ths = document.querySelectorAll("table.parc th.sortable");
  ths.forEach((th) => th.setAttribute("aria-sort", "none"));
  const stateTh = $("#th-etat");
  if (stateTh) stateTh.setAttribute("aria-sort", "descending"); // DOWN d'abord
  if (lastClients.length) renderTable(lastClients);
}
document.querySelectorAll("table.parc th.sortable").forEach((th) => {
  const trigger = () => applySort();
  th.addEventListener("click", trigger);
  th.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trigger(); }
  });
});

/* Pause du polling quand l'onglet est caché — L6. */
let pollId = null;
function startPolling() {
  if (pollId == null) pollId = setInterval(refresh, REFRESH_MS);
}
function stopPolling() {
  if (pollId != null) { clearInterval(pollId); pollId = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else {
    refresh(); // remet à jour immédiatement au retour
    startPolling();
  }
});

/* État réseau — L3. */
window.addEventListener("online", () => { announce("Connexion rétablie"); refresh(); });
window.addEventListener("offline", () => {
  $("#lastUpdate").textContent = "Hors ligne";
  $("#lastUpdate").classList.add("is-stale");
  announce("Hors ligne");
});

$("#refreshBtn").addEventListener("click", refresh);
applySort(); // initialise aria-sort par défaut
refresh();
startPolling();
