/* Consentement à la mesure d'audience (Loi 25 / RGPD).
   La mesure d'audience — beacons /v1/track (js/analytics.js) ET le compteur de
   présence temps réel (js/presence.js) — n'est activée qu'après consentement
   explicite. Tant qu'aucun choix n'est enregistré, AUCUNE mesure n'est faite et
   aucun identifiant n'est créé par le chargement des pages.

   Nuance importante (et documentée sur confidentialite.html) : les fonctions
   INTERACTIVES — voter à un sondage, aimer un titre, envoyer le formulaire,
   s'abonner aux rappels — créent l'identifiant anonyme hr.clientId au moment du
   clic, parce qu'elles en ont besoin (dédoublonnage des votes, suivi de la
   demande). Elles ne déclenchent aucune mesure d'audience pour autant. Le code
   qui part tout seul, lui, ne fait que LIRE l'identifiant (js/client-id.js :
   getClientId vs ensureClientId).

   Refuser (ou retirer son choix) efface l'identifiant.

   Le choix est stocké en localStorage (clé hr.consent) : "yes" | "no".
   Modifiable à tout moment (bouton #consentReset sur la page Confidentialité). */

import { store } from "./store.js";
import { clearClientId } from "./client-id.js";

const KEY = "hr.consent";
const EVT = "hr-consent-change";

export function getConsent() {
  const v = store.get(KEY);
  return v === "yes" || v === "no" ? v : null;
}

export function hasAnalyticsConsent() {
  return store.get(KEY) === "yes";
}

export function setConsent(value) {
  const v = value === "yes" ? "yes" : "no";
  store.set(KEY, v);
  if (v === "no") clearClientId(); // refus → on ne garde pas l'identifiant
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { consent: getConsent() } })); }
  catch { /* noop */ }
}

export function onConsentChange(cb) {
  try { window.addEventListener(EVT, () => cb(getConsent())); }
  catch { /* noop */ }
}

export function clearConsent() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
  clearClientId(); // retrait du choix → l'identifiant repart de zéro
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { consent: null } })); }
  catch { /* noop */ }
}

/* Bannière de consentement — position: fixed (pas de décalage de layout),
   styles injectés en scoped (styles.bundle.css inchangé). N'apparaît que tant
   qu'aucun choix n'est enregistré. */
const STYLES = `
#consentBar{position:fixed;inset:auto 0 0 0;z-index:9999;background:var(--surface,#1a1a1a);
  color:var(--ink,#f5f5f5);border-top:1px solid var(--line,rgba(255,255,255,.08));
  box-shadow:var(--shadow-rest,0 4px 24px rgba(0,0,0,.4));
  padding:var(--space-4,1rem) var(--space-5,1.25rem);
  display:flex;flex-wrap:wrap;gap:var(--space-3,.75rem) var(--space-5,1.25rem);
  align-items:center;justify-content:space-between;font-size:14px;line-height:1.45}
#consentBar p{margin:0;max-width:62ch;color:var(--ink,#f5f5f5)}
#consentBar a{color:var(--accent,#c8102e);text-decoration:underline}
#consentBar .consent-actions{display:flex;gap:var(--space-2,.5rem);flex-wrap:wrap}
#consentBar .consent-btn{appearance:none;border:1px solid var(--line,rgba(255,255,255,.18));
  background:transparent;color:var(--ink,#f5f5f5);padding:.55rem 1rem;border-radius:var(--radius-md,12px);
  font:inherit;font-weight:600;cursor:pointer}
#consentBar .consent-btn:focus-visible{outline:none;box-shadow:var(--focus-ring,0 0 0 2px var(--bg),0 0 0 4px rgba(220,20,48,.9))}
#consentBar .consent-accept{background:var(--accent,#c8102e);border-color:var(--accent,#c8102e);color:#fff}
@media (max-width:640px){#consentBar{flex-direction:column;align-items:stretch}#consentBar .consent-actions{justify-content:flex-end}}
@media (prefers-reduced-motion:reduce){#consentBar{transition:none}}
`;

function ensureStyles() {
  if (document.getElementById("consentBarStyles")) return;
  const s = document.createElement("style");
  s.id = "consentBarStyles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}

export function initConsent() {
  if (typeof document === "undefined" || !document.body) return;
  if (getConsent() !== null) return;           // déjà choisi → pas de bannière
  if (document.getElementById("consentBar")) return;
  ensureStyles();

  const bar = document.createElement("aside");
  bar.id = "consentBar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Consentement à la mesure d'audience");
  bar.innerHTML =
    '<p>Nous mesurons l\'audience (pages vues, temps d\'écoute) pour améliorer la radio. ' +
    'Aucune mesure n\'est faite avant ton accord. Voir la ' +
    '<a href="confidentialite.html">politique de confidentialité</a>.</p>' +
    '<div class="consent-actions">' +
    '<button type="button" class="consent-btn consent-refuse">Refuser</button>' +
    '<button type="button" class="consent-btn consent-accept">Accepter</button>' +
    '</div>';
  document.body.appendChild(bar);

  const close = () => { bar.remove(); };
  bar.querySelector(".consent-accept")?.addEventListener("click", () => { setConsent("yes"); close(); });
  bar.querySelector(".consent-refuse")?.addEventListener("click", () => { setConsent("no"); close(); });
}
