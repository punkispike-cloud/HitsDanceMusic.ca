/* Encodage du rendu : MP3 (lamejs) avec repli WAV natif si l'encodeur échoue.
 *  L'AudioBuffer de sortie est forcé à 44,1 kHz côté OfflineAudioContext (voir
 *  studio-engine.ts) → lamejs ne reçoit qu'un taux supporté. */

// Import dynamique : lamejs touche aux API navigateur et n'a pas de types TS.
// On déclare un type minimal pour l'usage qu'on en fait.
type Mp3EncoderCtor = new (channels: number, sampleRate: number, kbps: number) => {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array | Uint8Array;
  flush: () => Int8Array | Uint8Array;
};

let _Mp3Encoder: Mp3EncoderCtor | null | undefined;
async function loadEncoder(): Promise<Mp3EncoderCtor | null> {
  if (_Mp3Encoder !== undefined) return _Mp3Encoder;
  try {
    const mod = (await import("@breezystack/lamejs")) as unknown as { Mp3Encoder: Mp3EncoderCtor };
    _Mp3Encoder = mod.Mp3Encoder;
  } catch {
    _Mp3Encoder = null;
  }
  return _Mp3Encoder;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function encodeMp3(buffer: AudioBuffer, kbps = 192): Promise<Blob> {
  const Encoder = await loadEncoder();
  if (!Encoder) throw new Error("encodeur MP3 indisponible");
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const left = floatToInt16(buffer.getChannelData(0));
  const right = channels > 1 ? floatToInt16(buffer.getChannelData(1)) : left;
  const enc = new Encoder(channels, sampleRate, kbps);
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < samples; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = channels > 1 ? right.subarray(i, i + blockSize) : undefined;
    const buf = enc.encodeBuffer(l, r);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
  }
  const flushed = enc.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed));
  return new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c]![i]!));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}
