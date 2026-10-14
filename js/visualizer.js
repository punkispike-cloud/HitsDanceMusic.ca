/* Visualiseur du direct — spectre peint derrière les contrôles du player.

   Deux régimes, choisis au premier `playing` :
   - « réel » (Chromium) : audio.captureStream() → AnalyserNode. La sortie son
     reste celle de l'élément <audio> : RIEN ne transite par l'AudioContext.
     C'est délibéré. Router le direct dans le graphe (createMediaElementSource)
     rendrait le son dépendant de l'AudioContext : silence total si le contexte
     est suspendu (iOS écran verrouillé, onglet en arrière-plan) ou si la source
     perd ses en-têtes CORS. Pour un décor, ce risque sur l'antenne est inacceptable.
   - « décoratif » (Safari, Firefox, ou CORS perdu) : vagues douces calculées,
     sans prétention de suivre la musique.

   Le spectre réel exige que le flux soit lu en mode CORS (crossorigin), sinon
   la capture est « teintée » et muette. cast5 répond `Access-Control-Allow-Origin: *`
   (vérifié le 2026-10-14). Garde-fou si l'en-tête disparaît un jour : une erreur
   média ne distingue pas un refus CORS d'une coupure réseau, donc TOUTE erreur
   en mode CORS fait retirer l'attribut et basculer en décoratif. L'antenne passe
   avant le décor : au pire on perd le spectre réel pour la session, jamais le son.
   Au démarrage, player.js relance aussitôt via setPlayRetryHook (pas de
   « clique à nouveau ») ; en cours d'écoute, sa reconnexion fait le reste.

   prefers-reduced-motion : aucun canvas, aucune boucle (le CSS le masque aussi).
   La boucle ne tourne que si : lecture en cours ET panneau visible ET onglet affiché. */

import { setPlayRetryHook } from "./player.js";

const CORS_OFF_KEY = "hr.vizCorsOff";
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

let audio = null;
let panel = null;
let canvas = null;
let g2d = null;
let observers = [];

let mode = "idle";          // idle | real | deco
let corsProven = false;     // une lecture CORS a réussi dans cette session
let retryPending = false;   // repli CORS fait, démarrage à relancer
let ctx = null;             // AudioContext (régime réel seulement)
let analyser = null;
let srcNode = null;
let srcTrack = null;
let captured = null;        // MediaStream de captureStream()
let freq = null;

let raf = 0;
let playing = false;
let onScreen = true;
let levels = new Float32Array(0);
let ranges = [];            // [binDébut, binFin] par barre (échelle log)
let barCount = 0;
let colors = { base: "#c8102e", hot: "#e8192e" };  // repli si les tokens sont illisibles

const canCapture = () => typeof HTMLMediaElement !== "undefined" && "captureStream" in HTMLMediaElement.prototype;
const corsDisabled = () => { try { return sessionStorage.getItem(CORS_OFF_KEY) === "1"; } catch { return false; } };

export function initVisualizer() {
  audio = document.getElementById("radioPlayer");
  panel = document.querySelector("#player.player-2026");
  if (!audio || !panel || !("getContext" in HTMLCanvasElement.prototype)) return;

  // Mode CORS posé AVANT le premier `audio.src = …` de startPlayback : il
  // s'applique alors à toutes les connexions suivantes, reconnexions comprises.
  if (canCapture() && !corsDisabled()) {
    audio.crossOrigin = "anonymous";
    setPlayRetryHook(consumeRetry);
  }

  audio.addEventListener("playing", onPlaying);
  audio.addEventListener("pause", onStop);
  audio.addEventListener("ended", onStop);
  audio.addEventListener("error", onError);
  document.addEventListener("visibilitychange", syncLoop);
  reduceMotion?.addEventListener?.("change", () => {
    if (reduceMotion.matches) teardownCanvas();
    else if (playing) onPlaying();
    syncLoop();
  });
}

/* ---------- Cycle de vie ---------- */

function onPlaying() {
  playing = true;
  retryPending = false;
  if (audio.crossOrigin) corsProven = true;
  if (reduceMotion?.matches) return;
  ensureCanvas();
  if (mode === "idle") mode = startReal() ? "real" : "deco";
  else if (mode === "real") { rebindTrack(); void ctx?.resume?.(); }
  syncLoop();
}

function onStop() {
  playing = false;
  syncLoop();
  if (ctx?.state === "running") void ctx.suspend();
}

function onError() {
  if (!audio.crossOrigin) return;
  audio.removeAttribute("crossorigin");
  // Jamais réussi en CORS dans cette session → l'en-tête manque probablement :
  // inutile de le retenter aux pages suivantes de l'onglet.
  if (!corsProven) { try { sessionStorage.setItem(CORS_OFF_KEY, "1"); } catch { /* noop */ } }
  dropReal();
  if (mode === "real") mode = "deco";
  retryPending = true;
}

/* Consommé par startPlayback en cas d'échec : true une seule fois par repli. */
function consumeRetry() {
  if (!retryPending) return false;
  retryPending = false;
  return true;
}

/* ---------- Régime réel : capture → analyseur ---------- */

function startReal() {
  if (!audio.crossOrigin || !canCapture()) return false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    captured = audio.captureStream();
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;              // ~21 Hz par bin : assez fin pour les basses
    analyser.smoothingTimeConstant = 0.78;
    analyser.minDecibels = -88;
    analyser.maxDecibels = -18;
    freq = new Uint8Array(analyser.frequencyBinCount);
    // Sortie à gain nul : garantit que le graphe est « tiré » par le rendu
    // sans produire le moindre son (l'audio entendu reste celui de <audio>).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);
    // À chaque reconnexion (nouvelle src), Chromium ajoute une piste neuve.
    captured.addEventListener("addtrack", rebindTrack);
    rebindTrack();
    if (ctx.state === "suspended") {
      const kick = () => { void ctx?.resume(); };
      window.addEventListener("pointerdown", kick, { once: true });
      void ctx.resume();
    }
    computeRanges();
    return true;
  } catch {
    dropReal();
    return false;
  }
}

function rebindTrack() {
  if (!captured || !ctx || !analyser) return;
  const live = captured.getAudioTracks().filter((t) => t.readyState === "live");
  const track = live[live.length - 1];
  if (!track || track === srcTrack) return;
  try { srcNode?.disconnect(); } catch { /* noop */ }
  srcNode = ctx.createMediaStreamSource(new MediaStream([track]));
  srcNode.connect(analyser);
  srcTrack = track;
}

function dropReal() {
  try { srcNode?.disconnect(); } catch { /* noop */ }
  try { void ctx?.close(); } catch { /* noop */ }
  ctx = analyser = srcNode = srcTrack = captured = freq = null;
}

/* ---------- Canvas ---------- */

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "p26-visualizer";
  canvas.setAttribute("aria-hidden", "true");
  panel.prepend(canvas);
  g2d = canvas.getContext("2d");
  readColors();
  observers = [new ResizeObserver(resize), new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    syncLoop();
  })];
  observers[0].observe(canvas);
  observers[1].observe(panel);
  resize();
}

function teardownCanvas() {
  cancelAnimationFrame(raf);
  raf = 0;
  observers.forEach((o) => o.disconnect());
  observers = [];
  canvas?.remove();
  canvas = g2d = null;
  barCount = 0;
}

function readColors() {
  // Couleurs de marque lues sur les tokens : une autre radio (brand.css) hérite
  // automatiquement de son propre accent, sans toucher à ce fichier.
  const cs = getComputedStyle(panel);
  const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  colors = { base: pick("--accent", colors.base), hot: pick("--accent-bright", colors.hot) };
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  // Une barre tous les ~9 px CSS, bornée : lisible sur mobile, pas de bouillie en 4K.
  const n = Math.max(24, Math.min(72, Math.floor(canvas.clientWidth / 9)));
  if (n !== barCount) { barCount = n; levels = new Float32Array(n); computeRanges(); }
}

/* Barres réparties en échelle logarithmique de 40 Hz à 12 kHz : en linéaire,
   toute l'énergie d'un morceau dance tiendrait dans les cinq premières barres. */
function computeRanges() {
  ranges = [];
  if (!barCount) return;
  const nyquist = (ctx?.sampleRate || 48000) / 2;
  const bins = analyser?.frequencyBinCount || 1024;
  const lo = Math.log(40), hi = Math.log(12000);
  for (let i = 0; i < barCount; i++) {
    const f0 = Math.exp(lo + ((hi - lo) * i) / barCount);
    const f1 = Math.exp(lo + ((hi - lo) * (i + 1)) / barCount);
    const b0 = Math.min(bins - 1, Math.floor((f0 / nyquist) * bins));
    const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * bins)));
    ranges.push([b0, b1]);
  }
}

/* ---------- Boucle de rendu ---------- */

function syncLoop() {
  const run = playing && onScreen && !document.hidden && canvas && !reduceMotion?.matches;
  if (run && !raf) raf = requestAnimationFrame(frame);
  if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
}

function frame(t) {
  raf = 0;
  if (!canvas) return;
  sample(t);
  draw();
  syncLoop();
}

function sample(t) {
  const silent = audio.muted || audio.volume === 0;
  if (mode === "real" && analyser && freq) {
    analyser.getByteFrequencyData(freq);
    for (let i = 0; i < barCount; i++) {
      const [b0, b1] = ranges[i] || [0, 1];
      let peak = 0;
      for (let b = b0; b < b1; b++) if (freq[b] > peak) peak = freq[b];
      // Légère pente : les aigus portent moins d'énergie, on les relève un peu.
      const target = silent ? 0 : Math.min(1, (peak / 255) * (0.85 + 0.35 * (i / barCount)));
      ease(i, target);
    }
    return;
  }
  // Décoratif : somme de deux sinus déphasés par barre, amplitude modeste.
  const s = t / 1000;
  for (let i = 0; i < barCount; i++) {
    const x = i / barCount;
    const wave = 0.5 + 0.25 * Math.sin(s * 2.1 + x * 9) + 0.2 * Math.sin(s * 3.7 - x * 23);
    const target = silent ? 0 : Math.max(0.05, wave * (0.75 - 0.35 * x));
    ease(i, target);
  }
}

/* Montée rapide, retombée lente : le mouvement « respire » au lieu de trembler. */
function ease(i, target) {
  const cur = levels[i];
  levels[i] = target > cur ? cur + (target - cur) * 0.55 : cur + (target - cur) * 0.12;
}

function draw() {
  const { width: w, height: h } = canvas;
  g2d.clearRect(0, 0, w, h);
  if (!barCount) return;
  const slot = w / barCount;
  const bw = Math.max(1, slot * 0.62);
  const r = Math.min(bw / 2, 3 * (window.devicePixelRatio || 1));
  const grad = g2d.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, colors.hot);
  grad.addColorStop(0.55, colors.base);
  grad.addColorStop(1, "transparent");
  g2d.fillStyle = grad;
  g2d.beginPath();
  for (let i = 0; i < barCount; i++) {
    const bh = Math.max(2, levels[i] * h);
    const x = i * slot + (slot - bw) / 2;
    if (g2d.roundRect) g2d.roundRect(x, h - bh, bw, bh, [r, r, 0, 0]);
    else g2d.rect(x, h - bh, bw, bh);
  }
  g2d.fill();
}
