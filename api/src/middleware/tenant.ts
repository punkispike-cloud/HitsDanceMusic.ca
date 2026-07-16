/* Pose la radio courante (radio_id) sur le contexte.
   - publicTenant : site public + beacons → radio déduite de l'hôte HTTP.
   - adminTenant  : admin authentifié → radio de l'utilisateur (non cross-radio) ;
     l'owner (En Ondes) et le rôle `it` (technique cross-radio) choisissent la
     radio (header X-Radio-Id ou ?radio=) ou retombent sur l'unique radio du
     parc. */

import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types.js";
import { radioIdForHost, soleRadioId, radioExists, radioStatusFor } from "../services/tenant.js";
import { badRequest } from "../lib/errors.js";
import { isCrossRadio } from "../middleware/rbac.js";

// Préfixes exemptés de l'enforcement lifecycle (radio inactive) sur publicTenant :
// webhooks entrants, catalogue cross-radio, console owner, admin (adminTenant gère
// son propre enforcement). Le site public (schedule, shows, requests, polls, rss,
// share, push, account) est bloqué si la radio résolue n'est pas « active ».
const PUBLIC_ENFORCE_EXEMPT = ["/v1/webhooks/", "/v1/catalog", "/v1/owner", "/v1/admin"];

function isExempt(path: string): boolean {
  return PUBLIC_ENFORCE_EXEMPT.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p));
}

export const publicTenant: MiddlewareHandler<AppBindings> = async (c, next) => {
  const radioId = await radioIdForHost(c.req.header("host"));
  c.set("radioId", radioId);
  // Enforcement lifecycle : bloquer le site public si la radio n'est pas active
  // (provisioning / paused). Exempté des préfixes système/cross-radio.
  if (radioId && !isExempt(c.req.path)) {
    const status = await radioStatusFor(radioId);
    if (status && status !== "active") {
      return c.json(
        { error: { code: "radio_inactive", message: "Radio indisponible", status } },
        503,
      );
    }
  }
  await next();
};

export const adminTenant: MiddlewareHandler<AppBindings> = async (c, next) => {
  const user = c.get("user");
  if (!isCrossRadio(user.role)) {
    // superadmin / animateur / lecteur : strictement leur radio.
    const radioId = user.radioId ?? (await soleRadioId());
    c.set("radioId", radioId);
    // Enforcement lifecycle : bloquer l'accès admin non-cross-radio si la radio
    // n'est pas active (suspendue / en provisioning). L'owner (cross-radio) gère
    // la réactivation via /v1/owner/radios/:id (non bloqué).
    if (radioId) {
      const status = await radioStatusFor(radioId);
      if (status && status !== "active") {
        return c.json(
          { error: { code: "radio_inactive", message: "Radio suspendue — contactez En Ondes", status } },
          423,
        );
      }
    }
    return next();
  }
  // Owner + IT (cross-radio) : sélection explicite d'une radio, sinon l'unique
  // radio du parc. Pas d'enforcement (gère les radios provisioning/paused).
  const sel = c.req.header("X-Radio-Id") ?? c.req.query("radio");
  if (sel) {
    if (!(await radioExists(sel))) throw badRequest("Radio inconnue", "unknown_radio");
    c.set("radioId", sel);
  } else {
    c.set("radioId", await soleRadioId());
  }
  await next();
};
