/* Health check (calque presence /health). */

import { Hono } from "hono";
import { pingDb } from "../db/client.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const dbOk = await pingDb();
  return c.json({ ok: dbOk, db: dbOk, service: "hitradio-api" }, dbOk ? 200 : 503);
});
