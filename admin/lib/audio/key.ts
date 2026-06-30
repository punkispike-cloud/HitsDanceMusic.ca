/* Estimateur de tonalité (key) léger et maison : chromagramme par algorithme de
 *  Goertzel (pas de FFT/WASM) corrélé aux profils de Krumhansl-Schmuckler.
 *  Lecture seule — ne touche ni le graphe audio ni le rendu. Précision « DJ »
 *  approximative (utile pour mixer en harmonie / roue de Camelot), libellé
 *  toujours marqué comme estimation côté UI. Renvoie p.ex. "A min" / "C maj". */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Profils Krumhansl-Schmuckler (corrélats perceptifs des degrés d'une gamme).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Plage de notes analysées : MIDI 36 (C2 ≈ 65 Hz) → 83 (B5 ≈ 988 Hz), 4 octaves.
const MIDI_LOW = 36;
const MIDI_HIGH = 83;

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Énergie d'une fréquence sur un signal via Goertzel (1 passe O(N)). */
function goertzel(signal: Float32Array, sr: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < signal.length; i++) {
    s0 = signal[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power > 0 ? Math.sqrt(power) : 0;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

export function estimateKey(buffer: AudioBuffer): string | null {
  const srRaw = buffer.sampleRate;
  if (buffer.length < srRaw) return null; // < 1 s : pas assez de signal

  // Mix-down mono, borné aux 60 s centrales et décimé ×2 pour limiter le coût.
  const channels = buffer.numberOfChannels;
  const maxAnalyzed = Math.min(buffer.length, srRaw * 60);
  const start = Math.floor((buffer.length - maxAnalyzed) / 2);
  const decim = 2;
  const sr = srRaw / decim;
  const outLen = Math.floor(maxAnalyzed / decim);
  if (outLen < sr) return null;
  const mono = new Float32Array(outLen);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < outLen; i++) mono[i]! += data[start + i * decim]! / channels;
  }

  // Chromagramme : somme des magnitudes Goertzel par classe de hauteur.
  const chroma = new Array(12).fill(0) as number[];
  for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
    const mag = goertzel(mono, sr, midiToFreq(midi));
    chroma[midi % 12]! += mag;
  }
  const sum = chroma.reduce((s, v) => s + v, 0);
  if (sum <= 0) return null;
  for (let i = 0; i < 12; i++) chroma[i]! /= sum;

  // Meilleure tonique × mode par corrélation de Pearson.
  let bestScore = -Infinity;
  let bestTonic = 0;
  let bestMajor = true;
  for (let tonic = 0; tonic < 12; tonic++) {
    const maj = MAJOR_PROFILE.map((_, i) => MAJOR_PROFILE[(i - tonic + 12) % 12]!);
    const min = MINOR_PROFILE.map((_, i) => MINOR_PROFILE[(i - tonic + 12) % 12]!);
    const sMaj = pearson(chroma, maj);
    const sMin = pearson(chroma, min);
    if (sMaj > bestScore) {
      bestScore = sMaj;
      bestTonic = tonic;
      bestMajor = true;
    }
    if (sMin > bestScore) {
      bestScore = sMin;
      bestTonic = tonic;
      bestMajor = false;
    }
  }

  return `${NOTE_NAMES[bestTonic]} ${bestMajor ? "maj" : "min"}`;
}
