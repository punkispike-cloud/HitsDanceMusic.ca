import { test, expect } from "@playwright/test";

/* Le parcours qui porte le produit : presser lecture démarre le son.

   Le smoke existant vérifiait que l'accueil charge et que l'API répond — donc
   que la page est *présente*, jamais qu'elle *fonctionne*. Le seul parcours dont
   dépendent tous les autres n'avait aucune couverture (audit prod 2026-08-21).

   POURQUOI UN FLUX SIMULÉ. Tester contre le vrai flux AsuraHosting mesurerait
   deux choses à la fois — notre câblage et la santé d'un hébergeur déjà mesuré
   instable (il sous-livre ~10 %, cf. scripts/check-stream.mjs). Un échec ne
   dirait pas lequel des deux a lâché, et une vérification qui ne discrimine pas
   finit par être ignorée. Ici on ne teste QUE notre code ; le flux réel est
   couvert séparément par `npm run check:stream`, non bloquant.

   L'interception se fait sur `resourceType === "media"`, pas sur l'URL : le
   player pose `audio.src = ${STREAM_URL}?_=${Date.now()}` (js/player.js) et
   STREAM_URL vient de BRAND.stream.url — donc il change avec la marque buildée.
   Filtrer par type reste juste quelle que soit la marque. */

/** WAV PCM 16 bits mono silencieux — évite de commiter un binaire audio.
 *  Le silence suffit : on mesure l'avancée de currentTime, pas le son. */
function silentWav({ seconds = 30, rate = 8000 } = {}) {
  const dataBytes = seconds * rate * 2;
  const buf = Buffer.alloc(44 + dataBytes); // déjà à zéro = silence
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // taille du bloc fmt
  buf.writeUInt16LE(1, 20); // format PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // octets par seconde
  buf.writeUInt16LE(2, 32); // alignement de bloc
  buf.writeUInt16LE(16, 34); // bits par échantillon
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

const WAV = silentWav();

/** Sert le flux localement et coupe les tiers (pochettes iTunes, /np, API) pour
 *  que l'échec ne puisse venir que de notre câblage. */
async function stubStream(page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    if (req.resourceType() === "media") {
      return route.fulfill({ status: 200, contentType: "audio/wav", body: WAV });
    }
    let host = "";
    try {
      host = new URL(req.url()).hostname;
    } catch {
      /* URL non parsable → traitée comme externe */
    }
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
}

async function openHome(page) {
  // Consentement refusé + mention Loi 25 acquittée : sans ça la bannière
  // s'insère et décale la page (piège connu du filet visuel).
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hr.consent", "no");
      localStorage.setItem("audience-ack", "1");
    } catch {
      /* mode privé */
    }
  });
  await stubStream(page);
  // `load` et jamais `networkidle` : la page tient un SSE ouvert, networkidle
  // n'arrive donc jamais.
  await page.goto("/index.html", { waitUntil: "load" });
  await expect(page.locator("#playToggle")).toBeVisible({ timeout: 15_000 });
}

/** currentTime de l'élément audio — la seule preuve que le son avance vraiment. */
function currentTime(page) {
  return page.evaluate(() => {
    const a = document.getElementById("radioPlayer");
    return a ? a.currentTime : -1;
  });
}

test.describe("parcours auditeur — lecture", () => {
  test("presser lecture démarre le flux et le son avance", async ({ page }) => {
    await openHome(page);

    // Le clic Playwright EST un geste utilisateur : les politiques d'autoplay
    // ne bloquent pas, contrairement à un audio.play() déclenché en script.
    await page.locator("#playToggle").click();

    // 1. Le player s'annonce en lecture (contrat CSS↔JS : `is-playing-radio`
    //    est posé par setPlayingUI dans js/player.js).
    await expect(page.locator("body")).toHaveClass(/is-playing-radio/, { timeout: 20_000 });
    await expect(page.locator("#playToggle")).toHaveAttribute("data-state", "playing");

    // 2. Le son avance réellement. Un player qui affiche « En direct » avec un
    //    currentTime figé à 0 est exactement la panne que ce test doit attraper.
    await expect
      .poll(() => currentTime(page), { timeout: 20_000, message: "currentTime n'avance pas — le flux ne joue pas" })
      .toBeGreaterThan(0);

    const t1 = await currentTime(page);
    await page.waitForTimeout(1500);
    expect(await currentTime(page), "la lecture s'est arrêtée après avoir démarré").toBeGreaterThan(t1);
  });

  test("le bouton est accessible et annonce son état", async ({ page }) => {
    await openHome(page);
    const btn = page.locator("#playToggle");

    await expect(btn).toHaveAttribute("aria-label", "Lancer la radio");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-label", "Mettre la radio en pause", { timeout: 20_000 });
  });

  test("une seconde pression met en pause", async ({ page }) => {
    await openHome(page);
    const btn = page.locator("#playToggle");

    await btn.click();
    await expect(page.locator("body")).toHaveClass(/is-playing-radio/, { timeout: 20_000 });
    await expect.poll(() => currentTime(page), { timeout: 20_000 }).toBeGreaterThan(0);

    await btn.click();
    await expect(page.locator("body")).not.toHaveClass(/is-playing-radio/);
    await expect(btn).toHaveAttribute("data-state", "paused");

    // Pause réelle : le temps ne bouge plus. Le player relance une reconnexion
    // sur certains évènements — une pause qui redémarre toute seule serait un
    // vrai défaut, et c'est ce que cette assertion attrape.
    const t1 = await currentTime(page);
    await page.waitForTimeout(1500);
    expect(await currentTime(page), "la lecture a repris malgré la pause").toBeCloseTo(t1, 1);
  });
});
