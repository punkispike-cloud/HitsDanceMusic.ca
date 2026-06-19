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
