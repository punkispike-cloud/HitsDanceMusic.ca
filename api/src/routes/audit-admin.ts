/* Lecture du journal d'audit (superadmin uniquement — expose acteurs + IP).
   Monté sous /v1/admin/audit. */

import { Hono } from "hono";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { requireRole } from "../middleware/rbac.js";
import type { AppBindings } from "../types.js";

export const auditAdminRoutes = new Hono<AppBindings>();

auditAdminRoutes.get("/", requireRole("superadmin"), async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);
  const entity = c.req.query("entity");
  const action = c.req.query("action");

  const conds: SQL[] = [];
  if (entity) conds.push(eq(auditLog.entity, entity));
  if (action) conds.push(eq(auditLog.action, action));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [count]] = await Promise.all([
    db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);

  return c.json({ rows, total: count?.n ?? 0, limit, offset });
});
