/* Serveur statique minimal pour les tests visuels Playwright.
   Remplace `python -m http.server` pour supprimer la dépendance Python
   (sur Windows, `python` n'est pas toujours sur le PATH ; sur une CI fraîche,
   Python peut être absent). N'utilise que Node 18+ → environnement reproductible.

   Sert le dossier courant (cwd) avec les bons types MIME (notamment
   application/javascript pour les modules ES, sinon le navigateur refuse
   `import`), un fallback index.html sur "/" et une garde anti path traversal.

   Usage (depuis la racine du projet) :
     node tests/visual/serve.mjs            # port 8099
     node tests/visual/serve.mjs 8123       # port personnalisé
     PORT=8123 node tests/visual/serve.mjs

   Compatibilité comportementale avec python -m http.server : mêmes fichiers,
   mêmes types → rendu des pages identique → snapshots inchangés. */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || process.argv[2] || 8099);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".webp": "image/webp",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf":  "font/ttf",
  ".otf":  "font/otf",
  ".txt":  "text/plain; charset=utf-8",
  ".xml":  "application/xml; charset=utf-8",
  ".map":  "application/json; charset=utf-8",
};

function typeFor(p) {
  return MIME[extname(p).toLowerCase()] || "application/octet-stream";
}

// Garde anti path traversal : le chemin résolu doit rester sous ROOT.
function safeRel(urlPath) {
  const clean = urlPath.split("?")[0].split("#")[0];
  const decoded = decodeURIComponent(clean);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const abs = join(ROOT, rel);
  if (!abs.startsWith(ROOT) && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  try {
    let abs = safeRel(req.url || "/");
    if (!abs) { res.writeHead(403); return res.end("403 Forbidden"); }

    let s = await stat(abs).catch(() => null);
    // Répertoire → index.html (comportement http.server).
    if (s && s.isDirectory()) abs = join(abs, "index.html");
    s = s && await stat(abs).catch(() => null);

    if (!s || !s.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }

    const body = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": typeFor(abs),
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error: " + (err && err.message));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  // Signal de prêt déterministe pour Playwright (webServer.url).
  console.log(`[serve] http://127.0.0.1:${PORT} → ${ROOT}`);
});
