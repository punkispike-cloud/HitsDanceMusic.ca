/**
 * Hit Radio — Presence WebSocket service
 * Compte les visiteurs sur le site et les auditeurs actifs du flux.
 *
 * Protocole client → serveur (JSON) :
 *   { type: "listening", on: true|false }   // bascule l'état d'écoute
 *   { type: "ping" }                         // heartbeat (sinon pong serveur géré par ws)
 *
 * Protocole serveur → client (JSON, broadcast toutes les 2 s) :
 *   { type: "stats", visitors: N, listeners: M }
 */

import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8081;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const HEARTBEAT_MS = 25_000;     // ping aux clients toutes les 25 s
const BROADCAST_MS = 2_000;      // diffusion stats toutes les 2 s
const RATE_LIMIT_MSG_PER_SEC = 10;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      visitors: countVisitors(),
      listeners: countListeners(),
    }));
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Hit Radio presence service\n");
});

const wss = new WebSocketServer({
  server,
  path: "/ws/presence",
  // Vérification d'origine basique
  verifyClient: ({ origin }, cb) => {
    if (ALLOWED_ORIGINS.includes("*")) return cb(true);
    if (!origin) return cb(true); // navigateurs natifs sans Origin (rare)
    if (ALLOWED_ORIGINS.includes(origin)) return cb(true);
    cb(false, 403, "Forbidden origin");
  },
});

/** @type {Set<import("ws").WebSocket>} */
const clients = new Set();

function countVisitors() {
  return clients.size;
}
function countListeners() {
  let n = 0;
  for (const ws of clients) if (ws.isListening) n++;
  return n;
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

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.isListening = false;
  ws.msgWindowStart = Date.now();
  ws.msgInWindow = 0;
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
    if (ws.msgInWindow > RATE_LIMIT_MSG_PER_SEC) return;

    if (raw.length > 256) return; // payload trop gros = ignoré
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "listening") {
      ws.isListening = msg.on === true;
      // Broadcast immédiat sur changement d'état d'écoute
      broadcastStats();
    } else if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* noop */ }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });

  ws.on("error", () => {
    clients.delete(ws);
    try { ws.terminate(); } catch { /* noop */ }
  });

  // Envoi immédiat des stats au nouvel arrivant
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
