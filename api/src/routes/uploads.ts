/* Uploads audio (Phase 4) : flux pré-signé S3 en 3 temps.
   1) presign  → l'API valide, crée un upload_intent, renvoie l'URL PUT.
   2) le client PUT directement sur S3 (hors API).
   3) confirm  → l'API HEAD l'objet, vérifie taille/type, attache l'audio. */

import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { uploadIntents, episodes, mixes } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, notFound, forbidden, AppError } from "../lib/errors.js";
import { presignPut, headObject, publicUrl, isS3Configured } from "../lib/s3.js";
import { requireMinRole, assertCanActAs, isAdminOrAbove } from "../middleware/rbac.js";
import { requireRadioId } from "../services/tenant.js";
import type { AppBindings } from "../types.js";

export const uploadRoutes = new Hono<AppBindings>();

const AUDIO_MIME = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-m4a"]);
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function ensureS3(): void {
  if (!isS3Configured()) {
    throw new AppError(503, "s3_unconfigured", "Stockage S3 non configuré sur le serveur");
  }
}

const presignSchema = z.object({
  kind: z.enum(["episode", "mix", "cover"]),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

/* POST /v1/admin/uploads/presign */
uploadRoutes.post("/presign", requireMinRole("animateur"), async (c) => {
  ensureS3();
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = presignSchema.parse(await c.req.json());

  const isCover = body.kind === "cover";
  const allowed = isCover ? IMAGE_MIME : AUDIO_MIME;
  if (!allowed.has(body.contentType)) throw badRequest("Type de fichier non autorisé");
  const maxBytes = isCover ? 5_000_000 : env.MAX_AUDIO_BYTES;
  if (body.sizeBytes > maxBytes) throw badRequest("Fichier trop volumineux");

  const folder = body.kind === "episode" ? "episodes" : body.kind === "mix" ? "mixes" : "covers";
  const objectKey = `${folder}/${randomUUID()}.${EXT[body.contentType] ?? "bin"}`;

  const [intent] = await db
    .insert(uploadIntents)
    .values({
      radioId,
      userId: user.userId,
      kind: body.kind,
      objectKey,
      contentType: body.contentType,
      maxBytes,
    })
    .returning();

  const url = await presignPut(objectKey, body.contentType);
  return c.json({ intentId: intent!.id, objectKey, uploadUrl: url, expiresIn: 900 });
});

const confirmSchema = z.object({
  intentId: z.string().uuid(),
  targetId: z.string().uuid().optional(), // episode/mix à rattacher
  durationSec: z.number().int().positive().optional(),
});

/* POST /v1/admin/uploads/confirm */
uploadRoutes.post("/confirm", requireMinRole("animateur"), async (c) => {
  ensureS3();
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = confirmSchema.parse(await c.req.json());

  const intent = await db.query.uploadIntents.findFirst({
    where: and(eq(uploadIntents.id, body.intentId), eq(uploadIntents.radioId, radioId)),
  });
  if (!intent) throw notFound("Intent d'upload introuvable");
  if (intent.userId !== user.userId && !isAdminOrAbove(user.role))
    throw forbidden("Cet upload ne t'appartient pas");

  const head = await headObject(intent.objectKey);
  if (!head) throw badRequest("Objet absent sur S3 — upload incomplet ?");
  if (head.size > intent.maxBytes) throw badRequest("Taille réelle dépasse la limite");

  await db
    .update(uploadIntents)
    .set({ status: "completed" })
    .where(eq(uploadIntents.id, intent.id));

  const url = publicUrl(intent.objectKey);

  // Rattachement optionnel à un épisode/mix existant (branchement explicite
   // par type pour garder un typage Drizzle correct).
  if (body.targetId && intent.kind !== "cover") {
    const audioPatch = {
      audioUrl: url,
      audioKey: intent.objectKey,
      sizeBytes: head.size,
      durationSec: body.durationSec ?? null,
      updatedAt: new Date(),
    };
    if (intent.kind === "episode") {
      const target = await db.query.episodes.findFirst({
        where: and(eq(episodes.id, body.targetId), eq(episodes.radioId, radioId)),
        columns: { artistId: true },
      });
      if (!target) throw notFound("Cible introuvable");
      assertCanActAs(user, target.artistId);
      await db.update(episodes).set(audioPatch).where(and(eq(episodes.id, body.targetId), eq(episodes.radioId, radioId)));
    } else {
      const target = await db.query.mixes.findFirst({
        where: and(eq(mixes.id, body.targetId), eq(mixes.radioId, radioId)),
        columns: { artistId: true },
      });
      if (!target) throw notFound("Cible introuvable");
      assertCanActAs(user, target.artistId);
      await db.update(mixes).set(audioPatch).where(and(eq(mixes.id, body.targetId), eq(mixes.radioId, radioId)));
    }
  }

  return c.json({ ok: true, url, objectKey: intent.objectKey, sizeBytes: head.size });
});
