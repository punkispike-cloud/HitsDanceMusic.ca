/* Schémas Zod partagés + helpers de slug. */

import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email invalide")
  .max(254);

// 12 caractères minimum pour des comptes équipe (pas du grand public).
export const passwordSchema = z.string().min(12, "Mot de passe trop court (≥ 12)").max(200);

export const roleSchema = z.enum(["superadmin", "animateur", "lecteur"]);

export const slotTagSchema = z.enum([
  "morning",
  "hitlist",
  "drive",
  "limelight",
  "night",
  "special",
  "audition",
]);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120),
  role: roleSchema.default("lecteur"),
  artistId: z.string().uuid().nullish(),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** Slugifie un titre : minuscules, accents retirés, non-alphanum → tirets. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** "16:00" → 960. Retourne null si invalide. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** 960 → "16:00", 1440 → "24:00". */
export function fromMinutes(total: number): string {
  if (total === 1440) return "24:00";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
