/* Identifiant anonyme de visiteur (localStorage hr.clientId) — source UNIQUE.

   Deux accès volontairement distincts, pour tenir la promesse de la bannière de
   consentement (Loi 25) :

   - getClientId()    → LIT l'identifiant, n'en crée JAMAIS. À utiliser par tout
                        code qui part tout seul au chargement (widget sondage,
                        historique des titres…). Renvoie null s'il n'existe pas.
   - ensureClientId() → crée l'identifiant s'il manque. Réservé aux modules déjà
                        conditionnés au consentement (analytics, presence) et aux
                        actions DÉCLENCHÉES par la personne (voter, aimer un titre,
                        envoyer le formulaire) : dans ces cas l'identifiant est
                        nécessaire à la fonction demandée (dédoublonnage, suivi de
                        la demande), et la page Confidentialité le documente.

   Format imposé par l'API : [A-Za-z0-9_-]{8,64}. */

const KEY = "hr.clientId";
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

/** Identifiant existant, ou null. Ne crée rien, n'écrit rien. */
export function getClientId() {
  try {
    const id = localStorage.getItem(KEY);
    return id && VALID.test(id) ? id : null;
  } catch {
    return null; // mode privé / stockage bloqué
  }
}

function newId() {
  const raw =
    crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** Identifiant existant, sinon en crée un et le persiste. */
export function ensureClientId() {
  const existing = getClientId();
  if (existing) return existing;
  const id = newId();
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* mode privé → identifiant éphémère, non persisté */
  }
  return id;
}

/** Efface l'identifiant (retrait du consentement). */
export function clearClientId() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
