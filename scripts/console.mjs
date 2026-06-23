/* En Ondes — Centre de contrôle opérateur (console web LOCALE).
 * Sert operator/ + expose GET /api/parc (santé live du parc). Lié à 127.0.0.1
 * uniquement : aucune surface cloud, aucune auth, aucune écriture, aucun secret
 * (le registre ne contient que des domaines publics).
 *
 * Usage :
 *   node scripts/console.mjs            # http://127.0.0.1:4477
 *   node scripts/console.mjs --port 5000
 *   node scripts/console.mjs --no-open  # ne pas ouvrir le navigateur (headless)
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { buildParc } from "./lib/parc.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // racine du dépôt
const operatorDir = join(root, "operator");

const HOST = "127.0.0.1";
const portArg = process.argv.indexOf("--port");
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) || 4477 : 4477;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  let pathname = "/";
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    pathname = url.pathname;

    if (pathname === "/api/parc") {
      const parc = await buildParc();
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(parc));
      return;
    }

    // Statique depuis operator/ (avec garde anti-traversée de chemin).
    const rel = (pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
    const file = join(operatorDir, rel);
    if (!file.startsWith(operatorDir)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  const link = `http://${HOST}:${PORT}`;
  console.log(`\n🎛️  Centre de contrôle En Ondes → ${link}`);
  console.log("   Local uniquement · Ctrl-C pour quitter\n");
  if (!process.argv.includes("--no-open")) openBrowser(link);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✗ Port ${PORT} déjà utilisé. Relance avec --port <autre>.`);
    process.exit(1);
  }
  throw err;
});

function openBrowser(link) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", link], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [link], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [link], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* ouverture manuelle si l'auto-open échoue */
  }
}
