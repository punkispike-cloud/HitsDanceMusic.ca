/* Types partagés du studio de mix (Web Audio). Côté client uniquement. */

export type DeckId = "A" | "B";
export type EqBand = "low" | "mid" | "high";
export type LoadSource = "library" | "disk";

/** Référence à une piste chargée dans un deck (metadata seules — l'AudioBuffer
 *  est conservé dans le moteur, pas ici pour rester sérialisable). */
export interface TrackRef {
  id: string; // id bibliothèque ou "disk-<n>" pour un fichier local
  artist: string;
  title: string;
  bpm: number | null;
  durationSec: number | null;
  audioUrl: string | null;
  source: LoadSource;
}

/** Événement d'automation horodaté (temps transport = secondes depuis le démarrage).
 *  Rejoué tel quel par le moteur de rendu OfflineAudioContext. */
export interface AutomationEvent {
  t: number;
  type: "play" | "crossfade" | "pitch" | "eq" | "volume";
  deck?: DeckId;
  offset?: number; // play : position de départ dans le buffer (s)
  rate?: number; // pitch / play : playbackRate
  x?: number; // crossfade : 0 = A, 1 = B
  band?: EqBand; // eq
  gainDb?: number; // eq (dB)
  volume?: number; // volume (0..1)
  clip?: string; // play : id du clip (buffer + piste) actif → rendu multi-segments
}

export interface DeckState {
  loaded: boolean;
  track: TrackRef | null;
  buffer: AudioBuffer | null;
  clipId?: string; // id du clip courant dans la banque du moteur (rendu multi-segments)
  playing: boolean;
  offset: number; // position de cue / départ (s)
  rate: number; // playbackRate (1 + pitch%)
  eq: { low: number; mid: number; high: number }; // dB
  volume: number; // 0..1
  // Runtime (non persisté) : repère de lecture pour le playhead.
  playStartCtx?: number;
  playStartOffset?: number;
}

export interface TracklistEntry {
  pos: number;
  artist: string;
  title: string;
  timestamp: number;
}

export interface RenderResult {
  blob: Blob;
  mime: string;
  ext: "mp3" | "wav";
  durationSec: number;
  tracklist: TracklistEntry[];
}

export function emptyDeck(): DeckState {
  return {
    loaded: false,
    track: null,
    buffer: null,
    playing: false,
    offset: 0,
    rate: 1,
    eq: { low: 0, mid: 0, high: 0 },
    volume: 1,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
