/* Cockpit opérateur — récupère /api/parc et fait le rendu (KPIs + tableau).
   Aucune écriture : tout est en lecture seule, les actions sont des liens. */

const REFRESH_MS = 30_000;

const $ = (sel) => document.querySelector(sel);

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
  if (c.status === "provisioning") return `<span class="badge badge-prov">🟡 En cours</span>`;
  if (c.status === "paused") return `<span class="badge badge-paused">⏸ En pause</span>`;
  if (c.status !== "active") return `<span class="badge">${escapeHtml(c.status || "—")}</span>`;
  if (!c.health) return `<span class="badge">—</span>`;
  return c.health.up
    ? `<span class="badge badge-up">🟢 UP</span>`
    : `<span class="badge badge-down">🔴 DOWN</span>`;
}

function dbCell(c) {
  if (c.status !== "active" || !c.health) return "—";
  if (!c.health.up) return "—";
  return c.health.db ? `<span class="ok">ok</span>` : `<span class="bad">✗</span>`;
}

function latencyCell(c) {
  if (c.status !== "active" || !c.health || !c.health.up) return "—";
  const ms = c.health.ms;
  const cls = ms < 400 ? "lat-good" : ms < 1200 ? "lat-mid" : "lat-bad";
  return `<span class="${cls}">${ms} ms</span>`;
}

function licenseCell(c) {
  return c.licenses?.attested
    ? `<span class="ok" title="${escapeHtml(c.licenses?.note || "")}">✅ attestées</span>`
    : `<span class="warn" title="${escapeHtml(c.licenses?.note || "")}">⚠️ à confirmer</span>`;
}

function actionsCell(c) {
  const d = c.domains || {};
  const link = (href, label, title) =>
    href
      ? `<a class="act" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${title}">${label}</a>`
      : `<span class="act act-off" title="domaine non renseigné">${label}</span>`;
  const statsHref = d.admin ? `${d.admin.replace(/\/$/, "")}/statistiques` : "";
  const verifyCmd = d.api ? `node scripts/verify-deploy.mjs ${d.api}` : "";
  return [
    link(d.site, "Site", "Ouvrir le site"),
    link(d.admin, "Admin", "Ouvrir l'admin"),
    link(statsHref, "Stats", "Ouvrir les statistiques"),
    verifyCmd
      ? `<button class="act act-copy" type="button" data-copy="${escapeHtml(verifyCmd)}" title="Copier la commande verify-deploy">Vérifier ⧉</button>`
      : `<span class="act act-off">Vérifier</span>`,
  ].join(" ");
}

function renderKpis(k) {
  const cards = [
    { label: "Radios", value: k.total, cls: "" },
    { label: "🟢 En ligne", value: k.up, cls: "kpi-up" },
    { label: "🔴 Hors ligne", value: k.down, cls: k.down ? "kpi-down" : "" },
    { label: "⚠️ Licences à confirmer", value: k.licencesAConfirmer, cls: k.licencesAConfirmer ? "kpi-warn" : "" },
  ];
  if (typeof k.mrr === "number") {
    cards.push({ label: "Revenu mensuel", value: `${k.mrr.toLocaleString("fr-CA")} $`, cls: "kpi-mrr" });
  }
  $("#kpis").innerHTML = cards
    .map((c) => `<div class="kpi ${c.cls}"><div class="kpi-value">${escapeHtml(c.value)}</div><div class="kpi-label">${c.label}</div></div>`)
    .join("");
}

function renderTable(clients) {
  const body = $("#parcBody");
  if (!clients.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">Aucune radio dans le registre.</td></tr>`;
    return;
  }
  body.innerHTML = clients
    .map(
      (c) => `<tr>
        <td class="radio-name"><b>${escapeHtml(c.name)}</b>${c.role ? `<span class="role">${escapeHtml(c.role)}</span>` : ""}</td>
        <td>${stateBadge(c)}</td>
        <td>${dbCell(c)}</td>
        <td>${latencyCell(c)}</td>
        <td>${escapeHtml(c.tier || "—")}</td>
        <td>${licenseCell(c)}</td>
        <td>${fmtDate(c.commissioned)}</td>
        <td class="actions">${actionsCell(c)}</td>
      </tr>`,
    )
    .join("");
  $("#parcCount").textContent = `${clients.length} radio(s)`;
}

async function refresh() {
  const btn = $("#refreshBtn");
  btn.disabled = true;
  try {
    const r = await fetch("/api/parc", { cache: "no-store" });
    const parc = await r.json();
    renderKpis(parc.kpis);
    renderTable(parc.clients);
    $("#lastUpdate").textContent = `MAJ ${new Date().toLocaleTimeString("fr-CA")}`;
  } catch {
    $("#lastUpdate").textContent = "⚠️ erreur de chargement";
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("click", (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (!copyBtn) return;
  const cmd = copyBtn.getAttribute("data-copy");
  navigator.clipboard?.writeText(cmd).then(() => {
    const old = copyBtn.textContent;
    copyBtn.textContent = "Copié ✓";
    setTimeout(() => { copyBtn.textContent = old; }, 1400);
  });
});

$("#refreshBtn").addEventListener("click", refresh);
refresh();
setInterval(refresh, REFRESH_MS);
