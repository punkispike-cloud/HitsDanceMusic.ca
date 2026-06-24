/* Envoi d'emails transactionnels via Resend (API HTTP, pas de SDK).
   Inactif tant que RESEND_API_KEY absent : sendEmail renvoie alors false et
   logue le lien (utile en dev / avant configuration). */

import { env, isResendConfigured } from "../env.js";

interface MailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: MailInput): Promise<boolean> {
  if (!isResendConfigured()) {
    console.warn(`[email] Resend non configuré — email "${subject}" vers ${to} NON envoyé.`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] échec Resend (${res.status})`, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] erreur réseau Resend", err);
    return false;
  }
}

/** Gabarit HTML sombre cohérent avec l'identité Hits Dance Music. */
function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#0a0a0a;color:#eaeaea;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;color:#fff;margin:0 0 16px">${title}</h1>
    ${bodyHtml}
    <p style="margin-top:32px;font-size:12px;color:#888">Hits Dance Music — hitsdancemusic.ca</p>
  </div></body></html>`;
}

export function inviteEmailHtml(displayName: string, link: string): string {
  return wrap(
    "Bienvenue dans l'équipe 🎧",
    `<p>Salut ${displayName},</p>
     <p>Un compte vient d'être créé pour toi sur la console Hits Dance Music. Clique ci-dessous pour définir ton mot de passe :</p>
     <p style="margin:24px 0"><a href="${link}" style="background:#ff2d75;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Définir mon mot de passe</a></p>
     <p style="font-size:12px;color:#888">Ce lien expire dans 48 heures.</p>`,
  );
}

export function resetEmailHtml(link: string): string {
  return wrap(
    "Réinitialisation du mot de passe",
    `<p>Tu as demandé à réinitialiser ton mot de passe.</p>
     <p style="margin:24px 0"><a href="${link}" style="background:#ff2d75;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Choisir un nouveau mot de passe</a></p>
     <p style="font-size:12px;color:#888">Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>`,
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Alerte de flux : injoignable ("down") ou silence prolongé ("silent"). */
export function alertEmailHtml(radioName: string, kind: "down" | "silent", detail: string): string {
  const title = kind === "down" ? `🔴 ${radioName} — flux injoignable` : `🟠 ${radioName} — silence détecté`;
  return wrap(title, `<p>${esc(detail)}</p>
     <p style="font-size:13px;color:#aaa">Tu reçois cette alerte parce que la surveillance du flux est active sur En Ondes.</p>`);
}

export interface ReportEmailData {
  radioName: string;
  periodLabel: string; // ex. "mai 2026"
  listeners: number;
  listenLabel: string; // ex. "42 h 10 min"
  topShows: { title: string; listeners: number }[];
  topTracks: { label: string; plays: number }[];
  adminUrl: string;
}

/** Rapport mensuel d'audience d'une radio (envoyé au contact + à l'owner). */
export function reportEmailHtml(d: ReportEmailData): string {
  const showsRows = d.topShows.length
    ? d.topShows
        .map((s) => `<tr><td style="padding:4px 0">${esc(s.title)}</td><td style="text-align:right;color:#aaa">${s.listeners} auditeur(s)</td></tr>`)
        .join("")
    : `<tr><td style="color:#888">—</td></tr>`;
  const tracksRows = d.topTracks.length
    ? d.topTracks
        .map((t) => `<tr><td style="padding:4px 0">${esc(t.label)}</td><td style="text-align:right;color:#aaa">${t.plays}×</td></tr>`)
        .join("")
    : `<tr><td style="color:#888">—</td></tr>`;
  return wrap(
    `📊 ${d.radioName} — rapport de ${d.periodLabel}`,
    `<p>Voici le bilan d'audience de <strong>${esc(d.radioName)}</strong> pour ${d.periodLabel}.</p>
     <ul style="line-height:1.7">
       <li><strong>${d.listeners}</strong> auditeurs uniques</li>
       <li><strong>${d.listenLabel}</strong> d'écoute</li>
     </ul>
     <h2 style="font-size:15px;color:#fff;margin:24px 0 8px">Top émissions</h2>
     <table style="width:100%;border-collapse:collapse;font-size:14px">${showsRows}</table>
     <h2 style="font-size:15px;color:#fff;margin:24px 0 8px">Titres les plus joués</h2>
     <table style="width:100%;border-collapse:collapse;font-size:14px">${tracksRows}</table>
     <p style="margin:24px 0"><a href="${d.adminUrl}" style="background:#ff2d75;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Voir le détail</a></p>`,
  );
}
