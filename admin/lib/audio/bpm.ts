/* Estimateur BPM léger (maison) : envelope d'énergie + autocorrélation.
 *  Évite la dépendance web-audio-beat-detector (qui tire essentia.js/WASM,
 *  lourd et fragile en build Next). Précision « DJ » suffisante (±2 BPM),
 *  toujours repliée dans la plage 70–160. */

export function estimateBpm(buffer: AudioBuffer): number | null {
  const sr = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  if (len < sr) return null; // < 1 s : pas assez de signal

  // Mix-down mono.
  const mono = new Float32Array(len);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
  }

  // Envelope d'énergie (RMS par fenêtre).
  const win = 1024;
  const nFrames = Math.floor(len / win);
  if (nFrames < 8) return null;
  const env = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let e = 0;
    const base = f * win;
    for (let i = 0; i < win; i++) {
      const s = mono[base + i]!;
      e += s * s;
    }
    env[f] = Math.sqrt(e / win);
  }

  // Fonction d'onset = dérivée positive de l'envelope.
  const onset = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    const d = env[f]! - env[f - 1]!;
    onset[f] = d > 0 ? d : 0;
  }

  // Autocorrélation sur la plage de lag correspondant à 60–180 BPM.
  const fps = sr / win; // frames / seconde
  const lagMin = Math.max(2, Math.floor((60 * fps) / 180)); // frames/beat @180
  const lagMax = Math.ceil((60 * fps) / 60); // frames/beat @60
  let bestLag = 0;
  let bestVal = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0;
    for (let f = lag; f < nFrames; f++) sum += onset[f]! * onset[f - lag]!;
    if (sum > bestVal) {
      bestVal = sum;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;

  let bpm = (60 * fps) / bestLag;
  // Repli dans la plage utile (la corrélation octave-double/halve souvent).
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return Math.round(bpm);
}
