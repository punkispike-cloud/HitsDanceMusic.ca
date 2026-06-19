/* Journal d'audit : enregistre chaque mutation admin (POST/PATCH/DELETE) de
   façon transparente, après exécution du handler et seulement si elle a réussi
   (statut < 400). Approche middleware unique → couvre aussi les futures routes.
   Non bloquant : un échec d'écriture du log ne casse jamais la requête. */

import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLog, users } from "../db/schema.js";
import type { AppBindings } from "../types.js";

const ACTION_BY_METHOD: Record<string, string> = {
  POST: "create",
  PATCH: "update",
  PUT: "update",
  DELETE: "delete",
};

/** Extrait { entity, entityId } de /v1/admin/<entity>/<id?>. */
function parseTarget(path: string): { entity: string; entityId: string | null } {
  // path après montage = /v1/admin/artists/<id>
  const after = path.replace(/^.*\/v1\/admin\//, "");
  const parts = after.split("/").filter(Boolean);
  return { entity: parts[0] ?? "?", entityId: parts[1] ?? null };
}

function clientIp(c: Parameters<MiddlewareHandler>[0]): string | null {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? null;
}

export const auditMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  await next();

  const action = ACTION_BY_METHOD[c.req.method];
  if (!action) return; // GET / HEAD → rien à journaliser
  const status = c.res.status;
  if (status >= 400) return; // échec → pas de trace de mutation

  // Ne pas bloquer la réponse : journalisation best-effort en arrière-plan.
  void (async () => {
    try {
      const auth = c.get("user");
      const { entity, entityId: pathId } = parseTarget(c.req.path);

      // Pour un create, l'id est dans la réponse JSON.
      let entityId = pathId;
      if (!entityId) {
        const body = await c.res.clone().json().catch(() => null);
        if (body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string") {
          entityId = (body as { id: string }).id;
        }
      }

      // Instantané de l'acteur (survit à la suppression du compte).
      const actor = auth
        ? await db.query.users.findFirst({
            where: eq(users.id, auth.userId),
            columns: { email: true, displayName: true },
          })
        : null;

      await db.insert(auditLog).values({
        actorId: auth?.userId ?? null,
        actorEmail: actor?.email ?? null,
        actorName: actor?.displayName ?? null,
        actorRole: auth?.role ?? null,
        action,
        entity,
        entityId,
        ip: clientIp(c),
        summary: {},
      });
    } catch (err) {
      console.error("[audit] échec d'écriture (non bloquant)", err);
    }
  })();
};
