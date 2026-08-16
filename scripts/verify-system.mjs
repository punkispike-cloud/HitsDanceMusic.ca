#!/usr/bin/env node
/* Vérification exhaustive lecture seule — prod / staging.
 * Usage : node scripts/verify-system.mjs [prod|staging|both]
 * Ne mute pas de données (pas de POST créateurs). Auth attendue = 401/403.
 */
const TARGET = (process.argv[2] || "both").toLowerCase();

const ENVS = {
  prod: {
    label: "PROD",
    api: "https://patient-endurance-production-21c8.up.railway.app",
    site: "https://hitsdancemusic.ca",
    admin: "https://zucchini-charisma-production-3a67.up.railway.app",
    hub: "https://enondes-hub-production.up.railway.app",
    presence: "https://hitsdancemusicca-production.up.railway.app",
  },
  staging: {
    label: "STAGING",
    api: "https://patient-endurance-staging.up.railway.app",
    site: "https://hitdanceradioca-staging.up.railway.app",
    admin: "https://zucchini-charisma-staging.up.railway.app",
    hub: "https://enondes-hub-staging.up.railway.app",
    presence: "https://hitsdancemusicca-staging.up.railway.app",
  },
};

const TIMEOUT = 15_000;

async function req(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return { status: r.status, headers: r.headers, text, json, ok: r.ok };
  } finally {
    clearTimeout(t);
  }
}

function expectStatus(got, allowed) {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  return list.includes(got);
}

async function runEnv(env) {
  const rows = [];
  const check = async (group, name, fn) => {
    let verdict = "KO";
    let detail = "";
    try {
      const r = await fn();
      verdict = r.ok ? "OK" : "KO";
      detail = r.detail || "";
      if (r.gated) verdict = "GATED";
    } catch (e) {
      verdict = "KO";
      detail = e instanceof Error ? e.message : String(e);
    }
    rows.push({ group, name, verdict, detail });
    const icon = verdict === "OK" ? "✓" : verdict === "GATED" ? "○" : "✗";
    console.log(`  ${icon} [${group}] ${name}${detail ? " — " + detail : ""}`);
  };

  console.log(`\n═══ ${env.label} ═══\n`);

  // --- API health & public catalogue ---
  await check("api", "GET /health (db)", async () => {
    const r = await req(`${env.api}/health`);
    return {
      ok: r.status === 200 && r.json?.ok && r.json?.db,
      detail: `status=${r.status} db=${r.json?.db}`,
    };
  });

  const publicGets = [
    ["/v1/schedule", (j) => j && typeof j === "object" && "0" in j],
    ["/v1/schedule/now", (j) => j === null || (typeof j?.isLive === "boolean" && "next" in j)],
    ["/v1/artists", (j) => Array.isArray(j)],
    ["/v1/shows", (j) => Array.isArray(j)],
    ["/v1/episodes", (j) => Array.isArray(j)],
    ["/v1/mixes", (j) => Array.isArray(j)],
    ["/v1/tracks/recent", (j) => Array.isArray(j)],
    ["/v1/polls/active", (j) => j === null || (j && typeof j === "object")],
    ["/v1/catalog/tracks", (j) => j && (Array.isArray(j) || Array.isArray(j?.tracks) || Array.isArray(j?.items))],
    ["/v1/catalog/genres", (j) => Array.isArray(j) || Array.isArray(j?.genres)],
    ["/v1/push/vapid-public-key", (j) => typeof j?.enabled === "boolean"],
    ["/v1/rss/dummy-show-check", null], // may 404 — route exists as pattern; skip shape
  ];

  for (const [path, shape] of publicGets) {
    if (path.includes("dummy-show")) {
      await check("api", `GET ${path.replace("dummy-show-check", ":slug")} (route)`, async () => {
        const r = await req(`${env.api}/v1/rss/nonexistent-show-xyz`);
        return {
          ok: expectStatus(r.status, [404, 200]),
          detail: `status=${r.status}`,
        };
      });
      continue;
    }
    await check("api", `GET ${path}`, async () => {
      const r = await req(`${env.api}${path}`);
      const shapeOk = shape ? shape(r.json) : true;
      return {
        ok: r.status === 200 && shapeOk,
        detail: `status=${r.status}`,
      };
    });
  }

  // Auth walls
  const authWalls = [
    "/auth/me",
    "/v1/admin/media",
    "/v1/admin/analytics/overview",
    "/v1/admin/tracks/recent",
    "/v1/owner/overview",
    "/v1/owner/radios",
    "/v1/account/me",
    "/v1/account/favorites",
  ];
  for (const path of authWalls) {
    await check("api-auth", `GET ${path} → 401/403`, async () => {
      const r = await req(`${env.api}${path}`);
      return {
        ok: expectStatus(r.status, [401, 403]),
        detail: `status=${r.status}`,
      };
    });
  }

  // Gated / safe
  await check("api-gated", "POST /v1/webhooks/stripe → 503 (disabled)", async () => {
    const r = await req(`${env.api}/v1/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return {
      ok: r.status === 503,
      gated: r.status === 503,
      detail: `status=${r.status} code=${r.json?.error?.code || ""}`,
    };
  });

  await check("api-auth", "POST /auth/login (mauvais mdp → 401)", async () => {
    const r = await req(`${env.api}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-xx" }),
    });
    return {
      ok: expectStatus(r.status, [401, 400, 429]),
      detail: `status=${r.status}`,
    };
  });

  // Headers API
  await check("api", "Headers sécu /health", async () => {
    const r = await req(`${env.api}/health`);
    const xfo = r.headers.get("x-frame-options");
    const xcto = r.headers.get("x-content-type-options");
    return {
      ok: Boolean(xfo || xcto),
      detail: `XFO=${xfo || "—"} XCTO=${xcto || "—"}`,
    };
  });

  // Site pages
  const sitePages = [
    "/",
    "/index.html",
    "/horaire.html",
    "/emissions.html",
    "/animateurs.html",
    "/podcasts.html",
    "/contact.html",
    "/confidentialite.html",
    "/stats.html",
    "/sw.js",
    "/manifest.webmanifest",
  ];
  for (const p of sitePages) {
    await check("site", `GET ${p}`, async () => {
      const r = await req(`${env.site}${p}`);
      return { ok: r.status === 200, detail: `status=${r.status} len=${r.text.length}` };
    });
  }

  // Deny infra
  for (const p of ["/nginx.conf", "/Dockerfile", "/package.json", "/brand/hitsdance.json"]) {
    await check("site-deny", `GET ${p} → 404`, async () => {
      const r = await req(`${env.site}${p}`);
      return { ok: r.status === 404 || r.status === 403, detail: `status=${r.status}` };
    });
  }

  await check("site", "Headers HSTS/XFO", async () => {
    const r = await req(`${env.site}/`);
    const hsts = r.headers.get("strict-transport-security");
    const xfo = r.headers.get("x-frame-options");
    return {
      ok: Boolean(hsts && xfo),
      detail: `HSTS=${hsts ? "yes" : "no"} XFO=${xfo || "—"}`,
    };
  });

  // Admin
  await check("admin", "GET / (Next)", async () => {
    const r = await req(env.admin + "/");
    return {
      ok: expectStatus(r.status, [200, 307, 308, 302]),
      detail: `status=${r.status}`,
    };
  });
  await check("admin", "GET /login", async () => {
    const r = await req(env.admin + "/login");
    return {
      ok: expectStatus(r.status, [200, 307, 308, 302]),
      detail: `status=${r.status}`,
    };
  });

  // Hub
  await check("hub", "GET / (En Ondes)", async () => {
    const r = await req(env.hub + "/");
    const isEnOndes = /en\s*ondes/i.test(r.text);
    const isHits = /hits\s*dance/i.test(r.text) && !isEnOndes;
    return {
      ok: r.status === 200 && isEnOndes && !isHits,
      detail: `status=${r.status} enondes=${isEnOndes} wrongHits=${isHits}`,
    };
  });
  await check("hub", "GET /stations.json", async () => {
    const r = await req(env.hub + "/stations.json");
    return {
      ok: r.status === 200 && (Array.isArray(r.json) || Array.isArray(r.json?.stations)),
      detail: `status=${r.status}`,
    };
  });

  // Presence
  await check("presence", "GET /health", async () => {
    const r = await req(`${env.presence}/health`);
    return {
      ok: r.status === 200 && r.json?.ok === true,
      detail: `status=${r.status} visitors=${r.json?.visitors ?? "—"}`,
    };
  });

  return rows;
}

const targets =
  TARGET === "prod" ? ["prod"] : TARGET === "staging" ? ["staging"] : ["prod", "staging"];

const all = [];
for (const key of targets) {
  all.push(...(await runEnv(ENVS[key])));
}

const ok = all.filter((r) => r.verdict === "OK").length;
const gated = all.filter((r) => r.verdict === "GATED").length;
const ko = all.filter((r) => r.verdict === "KO");

console.log("\n═══ BILAN ═══");
console.log(`  OK=${ok}  GATED=${gated}  KO=${ko.length}  total=${all.length}`);
if (ko.length) {
  console.log("\nÉchecs :");
  for (const r of ko) console.log(`  ✗ [${r.group}] ${r.name} — ${r.detail}`);
}
process.exit(ko.length ? 1 : 0);
