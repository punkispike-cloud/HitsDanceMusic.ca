/* Pose la radio courante (radio_id) sur le contexte.
   - publicTenant : site public + beacons → radio déduite de l'hôte HTTP.
   - adminTenant  : admin authentifié → radio de l'utilisateur (non cross-radio) ;
     l'owner (En Ondes) et le rôle `it` (technique cross-radio) choisissent la
     radio (header X-Radio-Id ou ?radio=) ou retombent sur l'unique radio du
     parc. */

import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types.js";
import { radioIdForHost, soleRadioId, radioExists } from "../services/tenant.js";
import { badRequest } from "../lib/errors.js";
import { isCrossRadio } from "../middleware/rbac.js";

export const publicTenant: MiddlewareHandler<AppBindings> = async (c, next) => {
  c.set("radioId", await radioIdForHost(c.req.header("host")));
  await next();
};

export const adminTenant: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get("user");
  if (!isCrossRadio(user.role)) {
    // superadmin / animateur / lecteur : strictement leur radio.
    c.set("radioId", user.radioId ?? (await soleRadioId()));
    return next();
  }
  // Owner + IT (cross-radio) : sélection explicite d'une radio, sinon l'unique
  // radio du parc.
  const sel = c.req.header("X-Radio-Id") ?? c.req.query("radio");
  if (sel) {
    if (!(await radioExists(sel))) throw badRequest("Radio inconnue", "unknown_radio");
    c.set("radioId", sel);
  } else {
    c.set("radioId", await soleRadioId());
  }
  await next();
};
