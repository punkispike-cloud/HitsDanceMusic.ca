/* Middleware Next.js — garde anti-flash SERVEUR pour les routes admin.
   Protège les routes AVANT le rendu : sans marqueur de session, on redirige
   vers /login (NextResponse.redirect) au lieu de laisser le client découvrir
   l'absence de session après un flash de contenu (ex. accès direct à /parc).

   ─── Limite importante : garde présence-only, PAS une validation de session ───
   Le vrai secret de session est le cookie httpOnly `hr_refresh` posé par l'API,
   et l'access token JWT vit en mémoire côté client. AUCUN des deux n'est lisible
   ici :
   - `hr_refresh` est httpOnly (donc invisible au JS navigateur) MAIS surtout posé
     avec `path: "/auth"` et, en prod, sur un domaine distinct de l'admin
     (cross-site) → le navigateur ne l'envoie jamais vers l'origine admin ni vers
     une route non-/auth. Un middleware Next sur l'admin ne peut donc PAS le lire
     sur /parc, /dashboard, etc. (vérifié dans api/src/routes/auth.ts).
   - L'access token est en mémoire (jamais en cookie).

   On vérifie donc un cookie MARQUEUR `hr_session` (valeur "1", path /, posé sur
   l'origine admin par lib/auth.tsx lors du login / de la reprise silencieuse,
   effacé à la déconnexion / à la perte de session). Ce marqueur n'est PAS un
   secret : sa présence ne prouve pas une session valide, elle évite seulement le
   flash. L'API reste la source de vérité — si le marqueur existe sans session
   réelle, AuthProvider tente /auth/refresh, échoue, et redirige côté client vers
   /login (en effaçant le marqueur). */

import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "hr_session";

export function middleware(request: NextRequest) {
  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclut du middleware : pages publiques (/login, /set-password), chemins
  // internes Next (/_next/*), et fichiers statiques (favicon.ico, robots.txt,
  // tout chemin contenant un point). Tout le reste (routes (admin) + / ) est
  // protégé. /login et /set-password DOIVENT rester accessibles sans cookie,
  // sinon boucle de redirect.
  matcher: ["/((?!login|set-password|_next|favicon\\.ico|robots\\.txt|.*\\..*).*)"],
};
