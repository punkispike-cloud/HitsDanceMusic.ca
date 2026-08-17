/**
 * Hits Dance Music — Presence WebSocket service
 * Compte les visiteurs uniques (par clientId) et les auditeurs actifs.
 *
 * Protocole client → serveur (JSON) :
 *   { type: "hello", clientId: "<uuid>" }        // identifie le client
 *   { type: "listening", on: true|false }         // bascule l'état d'écoute
 *   { type: "ping" }                              // heartbeat
 *
 * Protocole serveur → client (JSON, broadcast toutes les 2 s) :
 *   { type: "stats", visitors: N, listeners: M }
 */

import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8081;

// Sécurité : par défaut, n'autoriser QUE les domaines de production.
const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS
    || "https://hitsdancemusic.ca,https://www.hitsdancemusic.ca"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Par défaut, on REFUSE les connexions sans Origin (clients non-navigateur,
// hors flux normal). Pour autoriser explicitement (dev local, tests),
// exporter ALLOW_NO_ORIGIN=1.
const ALLOW_NO_ORIGIN = process.env.ALLOW_NO_ORIGIN === "1";

// Plafond global anti-saturation triviale.
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || "5000", 10);

// Plafond PAR IP (audit 2026-08-16, G3) : l'Origin est forgeable par un client
// non-navigateur, donc on borne aussi côté réseau. Derrière le proxy Railway,
// l'IP cliente est dans x-forwarded-for (1re valeur).
const MAX_PER_IP = parseInt(process.env.MAX_PER_IP || "20", 10);

/** @type {Map<string, number>} connexions actives par IP */
const connectionsByIp = new Map();

function ipOf(req) {
  const xff = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
  return ip;
}

function trackIp(ip) {
  connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
}

function untrackIp(ip) {
  const n = (connectionsByIp.get(ip) || 0) - 1;
  if (n <= 0) connectionsByIp.delete(ip);
  else connectionsByIp.set(ip, n);
}

if (ALLOWED_ORIGINS.includes("*")) {
  console.warn(
    "[presence] ⚠️  ALLOWED_ORIGINS contient '*' — toutes les origines sont acceptées. "
      + "À NE PAS utiliser en production."
  );
} else {
  console.log("[presence] Origines autorisées :", ALLOWED_ORIGINS.join(", "));
}
if (ALLOW_NO_ORIGIN) {
  console.warn("[presence] ⚠️  ALLOW_NO_ORIGIN=1 — connexions sans Origin acceptées (dev only).");
}
console.log(`[presence] MAX_CONNECTIONS = ${MAX_CONNECTIONS}, MAX_PER_IP = ${MAX_PER_IP}`);

const HEARTBEAT_MS = 25_000;     // ping aux clients toutes les 25 s
const BROADCAST_MS = 2_000;      // diffusion stats toutes les 2 s
const RATE_LIMIT_MSG_PER_SEC = 10;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      connections: clients.size,
      visitors: countVisitors(),
      listeners: countListeners(),
    }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hits Dance Music presence service\n");
});

const wss = new WebSocketServer({
  server,
  path: "/ws/presence",
  // Vérification d'origine stricte par défaut + borne par IP.
  verifyClient: ({ origin, req }, cb) => {
    if (clients.size >= MAX_CONNECTIONS) return cb(false, 503, "Service overloaded");
    const ip = ipOf(req);
    if ((connectionsByIp.get(ip) || 0) >= MAX_PER_IP) {
      return cb(false, 429, "Too many connections from this IP");
    }
    if (ALLOWED_ORIGINS.includes("*")) {
      trackIp(ip);
      return cb(true);
    }
    if (!origin) {
      if (ALLOW_NO_ORIGIN) {
        trackIp(ip);
        return cb(true);
      }
      return cb(false, 403, "Origin required");
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      trackIp(ip);
      return cb(true);
    }
    cb(false, 403, "Forbidden origin");
  },
});

/** @type {Set<import("ws").WebSocket>} */
const clients = new Set();

// Visiteurs uniques : chaque client envoie son clientId (UUID stable
// stocké en localStorage). Un même UUID sur N onglets/connexions ne compte
// qu'une seule fois. Sans clientId, on ne compte pas (cas exceptionnel,
// car le front en envoie systématiquement).
function countVisitors() {
  const ids = new Set();
  for (const ws of clients) {
    if (ws.clientId) ids.add(ws.clientId);
  }
  return ids.size;
}
function countListeners() {
  const ids = new Set();
  for (const ws of clients) {
    if (ws.isListening && ws.clientId) ids.add(ws.clientId);
  }
  return ids.size;
}

function broadcastStats() {
  const payload = JSON.stringify({
    type: "stats",
    visitors: countVisitors(),
    listeners: countListeners(),
  });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(payload); } catch { /* noop */ }
    }
  }
}

// Diffusion immédiate à la réception d'un hello/listening, mais coalescée :
// sans ça, N messages valides = N broadcasts complets (amplification CPU sous
// flood — audit 2026-08-16). La boucle BROADCAST_MS assure la fraîcheur.
let lastImmediateBroadcast = 0;
function broadcastStatsThrottled() {
  const now = Date.now();
  if (now - lastImmediateBroadcast < 1000) return;
  lastImmediateBroadcast = now;
  broadcastStats();
}

function isValidClientId(id) {
  return typeof id === "string"
    && id.length >= 8 && id.length <= 64
    && /^[A-Za-z0-9_-]+$/.test(id);
}

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.isListening = false;
  ws.clientId = null;
  ws.msgWindowStart = Date.now();
  ws.msgInWindow = 0;
  // IP comptée dans verifyClient — on la retire au close (une seule fois).
  ws._ip = ipOf(req);
  ws._ipTracked = true;
  clients.add(ws);

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    // Rate limit anti-flood
    const now = Date.now();
    if (now - ws.msgWindowStart > 1000) {
      ws.msgWindowStart = now;
      ws.msgInWindow = 0;
    }
    ws.msgInWindow++;
    if (ws.msgInWindow > RATE_LIMIT_MSG_PER_SEC) {
      // Flood soutenu = on ferme la connexion (audit 2026-08-16 : le simple
      // « return » laissait la socket ouverte à spammer indéfiniment).
      if (ws.msgInWindow > RATE_LIMIT_MSG_PER_SEC * 5) {
        try { ws.close(1008, "rate limit"); } catch { /* noop */ }
      }
      return;
    }

    if (raw.length > 256) return; // payload trop gros = ignoré
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "hello") {
      if (isValidClientId(msg.clientId)) {
        ws.clientId = msg.clientId;
        broadcastStatsThrottled();
      }
    } else if (msg.type === "listening") {
      ws.isListening = msg.on === true;
      broadcastStatsThrottled();
    } else if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* noop */ }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (ws._ipTracked) {
      ws._ipTracked = false;
      untrackIp(ws._ip);
    }
  });

  ws.on("error", () => {
    clients.delete(ws);
    if (ws._ipTracked) {
      ws._ipTracked = false;
      untrackIp(ws._ip);
    }
    try { ws.terminate(); } catch { /* noop */ }
  });

  // Envoi immédiat des stats au nouvel arrivant (clientId inconnu encore)
  try {
    ws.send(JSON.stringify({
      type: "stats",
      visitors: countVisitors(),
      listeners: countListeners(),
    }));
  } catch { /* noop */ }
});

// Heartbeat : kill les connexions zombies (mobile mort, tunnel, etc.)
setInterval(() => {
  for (const ws of clients) {
    if (ws.isAlive === false) {
      clients.delete(ws);
      try { ws.terminate(); } catch { /* noop */ }
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, HEARTBEAT_MS).unref();

setInterval(broadcastStats, BROADCAST_MS).unref();

server.listen(PORT, () => {
  console.log(`[presence] listening on :${PORT}`);
  console.log(`[presence] allowed origins: ${ALLOWED_ORIGINS.join(", ") || "(none)"}`);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[presence] ${sig} received, closing…`);
    for (const ws of clients) {
      try { ws.close(1001, "server shutting down"); } catch { /* noop */ }
    }
    wss.close(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
