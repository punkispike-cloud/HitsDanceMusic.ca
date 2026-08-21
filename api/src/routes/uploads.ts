/* Uploads audio (Phase 4) : flux pré-signé S3 en 3 temps.
   1) presign  → l'API valide, crée un upload_intent, renvoie l'URL PUT.
   2) le client PUT directement sur S3 (hors API).
   3) confirm  → l'API HEAD l'objet, vérifie taille/type, attache l'audio. */

import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { uploadIntents, episodes, mixes, tracks, mediaAssets } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, notFound, forbidden, AppError } from "../lib/errors.js";
import { presignPut, headObject, publicUrl, deleteObject, isS3Configured } from "../lib/s3.js";
import { requireRole, assertCanActAs, isEditorialAdmin } from "../middleware/rbac.js";
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
  kind: z.enum(["episode", "mix", "cover", "track", "media"]),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

/* POST /v1/admin/uploads/presign — éditorial (animateur + superadmin + owner).
   `it` EXCLU : pas d'upload de contenu. */
uploadRoutes.post("/presign", requireRole("animateur", "superadmin", "owner"), async (c) => {
  ensureS3();
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = presignSchema.parse(await c.req.json());

  const isCover = body.kind === "cover";
  const allowed = isCover ? IMAGE_MIME : AUDIO_MIME;
  if (!allowed.has(body.contentType)) throw badRequest("Type de fichier non autorisé");
  const maxBytes = isCover ? 5_000_000 : env.MAX_AUDIO_BYTES;
  if (body.sizeBytes > maxBytes) throw badRequest("Fichier trop volumineux");

  const folder =
    body.kind === "episode" ? "episodes"
    : body.kind === "mix" ? "mixes"
    : body.kind === "track" ? "tracks"
    : body.kind === "media" ? "media"
    : "covers";
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

/* POST /v1/admin/uploads/confirm — éditorial (animateur + superadmin + owner).
   `it` EXCLU. */
uploadRoutes.post("/confirm", requireRole("animateur", "superadmin", "owner"), async (c) => {
  ensureS3();
  const radioId = requireRadioId(c.get("radioId"));
  const user = c.get("user");
  const body = confirmSchema.parse(await c.req.json());

  const intent = await db.query.uploadIntents.findFirst({
    where: and(eq(uploadIntents.id, body.intentId), eq(uploadIntents.radioId, radioId)),
  });
  if (!intent) throw notFound("Intent d'upload introuvable");
  if (intent.userId !== user.userId && !isEditorialAdmin(user.role))
    throw forbidden("Cet upload ne t'appartient pas");

  const head = await headObject(intent.objectKey);
  if (!head) throw badRequest("Objet absent sur S3 — upload incomplet ?");

  // L'URL pré-signée ne borne QUE la clé et le Content-Type : rien n'empêche le
  // client d'y pousser un objet plus gros que `sizeBytes` déclaré au presign.
  // On le détecte ici — et on SUPPRIME l'objet fautif tout de suite plutôt que
  // de le laisser occuper le bucket jusqu'à la purge d'entretien (24 h), sinon
  // un compte éditorial peut faire enfler le stockage par rejets successifs.
  const reject = async (message: string): Promise<never> => {
    await deleteObject(intent.objectKey).catch((err) => {
      console.warn(`[uploads] suppression de l'objet rejeté "${intent.objectKey}" échouée`, err);
    });
    await db
      .update(uploadIntents)
      .set({ status: "aborted" })
      .where(eq(uploadIntents.id, intent.id));
    throw badRequest(message);
  };

  if (head.size > intent.maxBytes) await reject("Taille réelle dépasse la limite");
  // Vérif du Content-Type RÉEL stocké vs celui déclaré à l'intention (défense en
  // profondeur : la signature présignée lie déjà le type, mais on ne fait pas
  // confiance au stockage). On compare sans les paramètres éventuels (; charset…).
  const actualType = head.contentType.split(";")[0]?.trim().toLowerCase();
  if (actualType !== intent.contentType.toLowerCase()) {
    await reject("Le type réel du fichier ne correspond pas à l'upload déclaré");
  }

  await db
    .update(uploadIntents)
    .set({ status: "completed" })
    .where(eq(uploadIntents.id, intent.id));

  const url = publicUrl(intent.objectKey);

  // Rattachement optionnel à un épisode/mix/piste existant (branchement explicite
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
    } else if (intent.kind === "media") {
      // Médias (jingles/pubs) : pas d'artistId — radioId + rôle éditorial (gate
      // presign) protègent l'écriture. La table n'a ni audioKey ni sizeBytes.
      const target = await db.query.mediaAssets.findFirst({
        where: and(eq(mediaAssets.id, body.targetId), eq(mediaAssets.radioId, radioId)),
        columns: { id: true },
      });
      if (!target) throw notFound("Cible introuvable");
      await db
        .update(mediaAssets)
        .set({ audioUrl: url, durationSec: body.durationSec ?? null, updatedAt: new Date() })
        .where(and(eq(mediaAssets.id, body.targetId), eq(mediaAssets.radioId, radioId)));
    } else if (intent.kind === "track") {
      // Les pistes de la bibliothèque n'ont pas d'artistId (artiste = texte libre) :
      // seules le radioId + le rôle éditorial (gate presign) protègent l'écriture.
      const target = await db.query.tracks.findFirst({
        where: and(eq(tracks.id, body.targetId), eq(tracks.radioId, radioId)),
        columns: { id: true },
      });
      if (!target) throw notFound("Cible introuvable");
      await db.update(tracks).set(audioPatch).where(and(eq(tracks.id, body.targetId), eq(tracks.radioId, radioId)));
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
