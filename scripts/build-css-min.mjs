/* Wrapper cross-platform pour produire un bundle CSS minifié (option de prod).
   Active CSS_MINIFY puis ré-exécute build-css.mjs (qui lit l'env au chargement).
   Évite la dépendance cross-env (CSS_MINIFY=1 node ... n'est pas portable Windows).
   Artefact de déploiement : ne pas committer (le bundle versionné reste non minifié). */

process.env.CSS_MINIFY = "1";
await import("./build-css.mjs");
