/* StudioEngine : moteur Web Audio du studio de mix.
 *  - Live : 2 decks (source → EQ 3 bandes → volume → crossfade → master → out),
 *    crossfader equal-power, pitch (playbackRate), sync B→A.
 *  - Capture d'automation horodatée (temps transport) à chaque action utilisateur.
 *  - render() : replanifie la performance dans un OfflineAudioContext (44,1 kHz)
 *    → AudioBuffer → MP3 (lamejs) ou repli WAV → Blob + tracklist auto.
 *
 *  Rendu multi-segments : chaque chargement crée un « clip » (buffer + piste)
 *  ré-utilisable, et le rendu produit une source par clip joué. Un même deck peut
 *  donc enchaîner plusieurs pistes (set > 2 pistes) ; les ré-cues/seeks d'un même
 *  clip se collapsent (dernière lecture du clip = trajectoire retenue). */

import { estimateBpm } from "./bpm";
import { estimateKey } from "./key";
import { encodeMp3, encodeWav } from "./encode";
import { clamp, emptyDeck, type AutomationEvent, type DeckId, type DeckState, type EqBand, type RenderResult, type TrackRef } from "./types";

const EQ_FREQ: Record<EqBand, number> = { low: 200, mid: 1000, high: 4500 };
const RENDER_SR = 44100; // lamejs supporte 44100 → on force ce taux au rendu.

interface DeckNodes {
  source: AudioBufferSourceNode | null;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  volume: GainNode;
  dry: GainNode;
  convolver: ConvolverNode;
  wet: GainNode;
  mix: GainNode;
  cross: GainNode;
}

/** Réverbe synthétique : bruit blanc à décroissance exponentielle (aucun asset
 *  externe). Généré au sample-rate du contexte pour un temps de chute correct. */
function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * rate));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return ir;
}

function makeDeckNodes(ctx: BaseAudioContext, master: GainNode, ir: AudioBuffer): DeckNodes {
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = EQ_FREQ.low;
  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = EQ_FREQ.mid;
  eqMid.Q.value = 1;
  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = EQ_FREQ.high;
  const volume = ctx.createGain();
  // Bus humide/sec parallèle : volume → [dry → mix] + [convolver → wet → mix] → cross.
  // wet = 0 par défaut → mix == dry → identique au signal sans réverbe (zéro régression).
  const dry = ctx.createGain();
  dry.gain.value = 1;
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0;
  const mix = ctx.createGain();
  const cross = ctx.createGain();
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(volume);
  volume.connect(dry);
  dry.connect(mix);
  volume.connect(convolver);
  convolver.connect(wet);
  wet.connect(mix);
  mix.connect(cross);
  cross.connect(master);
  return { source: null, eqLow, eqMid, eqHigh, volume, dry, convolver, wet, mix, cross };
}

function crossGainA(x: number): number {
  return Math.cos(clamp(x, 0, 1) * (Math.PI / 2));
}
function crossGainB(x: number): number {
  return Math.sin(clamp(x, 0, 1) * (Math.PI / 2));
}

export class StudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private ir!: AudioBuffer; // impulse de réverbe (live), partagée par les 2 decks
  private decks: Record<DeckId, DeckNodes>;
  state: Record<DeckId, DeckState>;
  automation: AutomationEvent[] = [];
  crossfader = 0.5;
  private transportStartCtx = 0;
  private started = false;
  // Banque de clips : chaque chargement crée un clip (buffer + piste) ré-utilisable
  // par toutes ses lectures. Permet de rendre plusieurs pistes successives sur un
  // même deck, pas seulement la dernière chargée.
  private clips = new Map<string, { buffer: AudioBuffer; track: TrackRef }>();
  private clipSeq = 0;

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.ir = makeImpulseResponse(this.ctx, 1.6, 3);
    this.decks = { A: makeDeckNodes(this.ctx, this.master, this.ir), B: makeDeckNodes(this.ctx, this.master, this.ir) };
    this.state = { A: emptyDeck(), B: emptyDeck() };
    this.applyCrossfader(0.5);
  }

  /* ───────────────────────── Chargement ───────────────────────── */

  async load(deckId: DeckId, track: TrackRef, data: ArrayBuffer): Promise<{ bpm: number | null }> {
    const buffer = await this.ctx.decodeAudioData(data.slice(0));
    const bpm = track.bpm ?? estimateBpm(buffer);
    const key = track.key ?? estimateKey(buffer);
    const finalTrack = { ...track, bpm, key };
    const clipId = `clip-${++this.clipSeq}`;
    this.clips.set(clipId, { buffer, track: finalTrack });
    this.state[deckId] = {
      ...this.state[deckId],
      loaded: true,
      track: finalTrack,
      buffer,
      clipId,
      offset: 0,
    };
    this.applyEq(deckId);
    this.applyVolume(deckId);
    this.applyReverb(deckId);
    return { bpm };
  }

  /* ───────────────────────── Transport ───────────────────────── */

  private ensureTransport(): void {
    if (this.started) return;
    this.started = true;
    this.transportStartCtx = this.ctx.currentTime;
    // Snapshot de l'état initial à t=0 (crossfader + EQ/volume des decks chargés)
    // pour que le rendu parte d'une base correcte même si l'utilisateur n'a pas
    // touché ces contrôles après le démarrage.
    this.automation.push({ t: 0, type: "crossfade", x: this.crossfader });
    for (const id of ["A", "B"] as DeckId[]) {
      const d = this.state[id];
      if (d.loaded) {
        this.automation.push({ t: 0, type: "eq", deck: id, band: "low", gainDb: d.eq.low });
        this.automation.push({ t: 0, type: "eq", deck: id, band: "mid", gainDb: d.eq.mid });
        this.automation.push({ t: 0, type: "eq", deck: id, band: "high", gainDb: d.eq.high });
        this.automation.push({ t: 0, type: "volume", deck: id, volume: d.volume });
        this.automation.push({ t: 0, type: "reverb", deck: id, wet: d.reverb });
      }
    }
  }

  private tNow(): number {
    return this.started ? this.ctx.currentTime - this.transportStartCtx : 0;
  }

  /* ───────────────────────── Lecture ───────────────────────── */

  async play(deckId: DeckId, offset?: number): Promise<void> {
    const d = this.state[deckId];
    if (!d.buffer) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.ensureTransport();
    this.stopSource(deckId);
    const src = this.ctx.createBufferSource();
    src.buffer = d.buffer;
    src.playbackRate.value = d.rate;
    src.connect(this.decks[deckId].eqLow);
    const off = clamp(offset ?? d.offset, 0, Math.max(0, d.buffer.duration - 0.01));
    src.start(0, off);
    this.decks[deckId].source = src;
    d.playing = true;
    d.playStartCtx = this.ctx.currentTime;
    d.playStartOffset = off;
    this.automation.push({ t: this.tNow(), type: "play", deck: deckId, offset: off, rate: d.rate, clip: d.clipId });
    src.onended = () => {
      if (this.decks[deckId].source === src) {
        d.playing = false;
      }
    };
  }

  stop(deckId: DeckId): void {
    this.stopSource(deckId);
    this.state[deckId].playing = false;
  }

  /** Position de lecture courante (s) dans le buffer — pour le playhead waveform. */
  deckPosition(deckId: DeckId): number {
    const d = this.state[deckId];
    if (!d.buffer) return 0;
    if (d.playing && d.playStartCtx != null) {
      const elapsed = (this.ctx.currentTime - d.playStartCtx) * d.rate;
      return Math.min(d.buffer.duration, d.playStartOffset! + elapsed);
    }
    return d.offset;
  }

  /** Déplace la tête de lecture (et relance si le deck jouait). */
  async seek(deckId: DeckId, pos: number): Promise<void> {
    const d = this.state[deckId];
    if (!d.buffer) return;
    const p = clamp(pos, 0, d.buffer.duration);
    d.offset = p;
    if (d.playing) await this.play(deckId, p);
  }

  private stopSource(deckId: DeckId): void {
    const n = this.decks[deckId];
    if (n.source) {
      try {
        n.source.onended = null;
        n.source.stop();
      } catch {
        /* déjà stoppé */
      }
      try {
        n.source.disconnect();
      } catch {
        /* noop */
      }
      n.source = null;
    }
  }

  /* ───────────────────────── Contrôles ───────────────────────── */

  setRate(deckId: DeckId, rate: number): void {
    const r = clamp(rate, 0.5, 2);
    this.state[deckId].rate = r;
    const n = this.decks[deckId];
    if (n.source) n.source.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.02);
    this.automation.push({ t: this.tNow(), type: "pitch", deck: deckId, rate: r });
  }

  setEq(deckId: DeckId, band: EqBand, gainDb: number): void {
    const g = clamp(gainDb, -24, 12);
    this.state[deckId].eq[band] = g;
    this.applyEq(deckId);
    this.automation.push({ t: this.tNow(), type: "eq", deck: deckId, band, gainDb: g });
  }

  private applyEq(deckId: DeckId): void {
    const n = this.decks[deckId];
    const e = this.state[deckId].eq;
    n.eqLow.gain.value = e.low;
    n.eqMid.gain.value = e.mid;
    n.eqHigh.gain.value = e.high;
  }

  setVolume(deckId: DeckId, v: number): void {
    const vol = clamp(v, 0, 1.5);
    this.state[deckId].volume = vol;
    this.applyVolume(deckId);
    this.automation.push({ t: this.tNow(), type: "volume", deck: deckId, volume: vol });
  }

  private applyVolume(deckId: DeckId): void {
    this.decks[deckId].volume.gain.value = this.state[deckId].volume;
  }

  setReverb(deckId: DeckId, wet: number): void {
    const w = clamp(wet, 0, 0.9);
    this.state[deckId].reverb = w;
    this.applyReverb(deckId);
    this.automation.push({ t: this.tNow(), type: "reverb", deck: deckId, wet: w });
  }

  private applyReverb(deckId: DeckId): void {
    this.decks[deckId].wet.gain.value = this.state[deckId].reverb;
  }

  setCrossfader(x: number): void {
    this.crossfader = clamp(x, 0, 1);
    this.applyCrossfader(this.crossfader);
    this.automation.push({ t: this.tNow(), type: "crossfade", x: this.crossfader });
  }

  private applyCrossfader(x: number): void {
    this.decks.A.cross.gain.value = crossGainA(x);
    this.decks.B.cross.gain.value = crossGainB(x);
  }

  /** Sync B → A : rateB tel que BPM_effectif(B) = BPM_effectif(A). */
  syncBtoA(): void {
    const a = this.state.A;
    const b = this.state.B;
    if (!a.track?.bpm || !b.track?.bpm) return;
    const effA = a.track.bpm * a.rate;
    this.setRate("B", clamp(effA / b.track.bpm, 0.5, 2));
  }

  /** BPM effectif d'un deck (bpm piste × playbackRate). */
  effectiveBpm(deckId: DeckId): number | null {
    const d = this.state[deckId];
    if (!d.track?.bpm) return null;
    return Math.round(d.track.bpm * d.rate);
  }

  /** Force le BPM d'un deck (tap tempo / saisie manuelle), borné à une plage utile. */
  setBpm(deckId: DeckId, bpm: number): void {
    const d = this.state[deckId];
    if (!d.track || !Number.isFinite(bpm)) return;
    d.track = { ...d.track, bpm: clamp(Math.round(bpm), 40, 300) };
  }

  /** Ré-estime le BPM depuis le buffer du deck (autocorrélation). Renvoie la valeur. */
  reanalyzeBpm(deckId: DeckId): number | null {
    const d = this.state[deckId];
    if (!d.buffer || !d.track) return null;
    const bpm = estimateBpm(d.buffer);
    if (bpm) d.track = { ...d.track, bpm };
    return bpm;
  }

  /** Réinitialise l'automation (nouveau set) sans décharger les decks. */
  resetAutomation(): void {
    this.automation = [];
    this.started = false;
    this.stop("A");
    this.stop("B");
    // Nouveau set : banque de clips repartie de zéro, en ré-enregistrant les pistes
    // actuellement chargées pour que les prochaines lectures aient un clip valide.
    this.clips.clear();
    for (const id of ["A", "B"] as DeckId[]) {
      const d = this.state[id];
      if (d.loaded && d.buffer && d.track) {
        const clipId = `clip-${++this.clipSeq}`;
        this.clips.set(clipId, { buffer: d.buffer, track: d.track });
        d.clipId = clipId;
      } else {
        d.clipId = undefined;
      }
    }
  }

  /* ───────────────────────── Rendu ───────────────────────── */

  async render(): Promise<RenderResult> {
    // Un « segment » = une lecture effective d'un clip. On garde la DERNIÈRE lecture
    // par clip (ré-cues/seeks d'un même clip écrasent la trajectoire), ce qui autorise
    // plusieurs clips successifs par deck tout en ignorant les seeks intermédiaires.
    const playEvents = this.automation.filter(
      (e): e is AutomationEvent & { deck: DeckId; offset: number; clip: string } =>
        e.type === "play" && !!e.deck && e.offset != null && !!e.clip && this.clips.has(e.clip),
    );
    const lastByClip = new Map<string, (typeof playEvents)[number]>();
    for (const e of playEvents) lastByClip.set(e.clip, e); // tableau ordonné dans le temps → la dernière gagne

    const segments = Array.from(lastByClip.values())
      .map((e) => {
        const clip = this.clips.get(e.clip)!;
        return {
          deck: e.deck,
          t: e.t,
          offset: e.offset,
          rate: e.rate ?? 1,
          buffer: clip.buffer,
          track: clip.track,
          cutAt: null as number | null,
          ratesInWindow: [] as { t: number; rate: number }[],
        };
      })
      .sort((a, b) => a.t - b.t);

    if (segments.length === 0) throw new Error("Rien à rendre : charge une piste et lance la lecture.");

    // Bornes : démarrer un nouveau clip sur un deck coupe la source précédente du même
    // deck (comportement live : play() fait stopSource() d'abord). Les paliers de pitch
    // de la fenêtre du segment pilotent sa source.
    for (const seg of segments) {
      let cut: number | null = null;
      for (const o of segments) {
        if (o.deck === seg.deck && o.t > seg.t) cut = cut == null ? o.t : Math.min(cut, o.t);
      }
      seg.cutAt = cut;
      seg.ratesInWindow = this.automation
        .filter(
          (e) =>
            e.type === "pitch" && e.deck === seg.deck && e.rate != null && e.t > seg.t && (cut == null || e.t < cut),
        )
        .sort((a, b) => a.t - b.t) as { t: number; rate: number }[];
    }

    // Durée totale = fin audible la plus tardive (segment fini naturellement ou coupé).
    let total = 0;
    for (const seg of segments) {
      const natural = this.segmentEnd(seg.buffer.duration, seg.offset, seg.t, seg.rate, seg.ratesInWindow);
      const end = seg.cutAt != null ? Math.min(natural, seg.cutAt) : natural;
      total = Math.max(total, end);
    }
    total += 0.08; // queue

    const off = new OfflineAudioContext(2, Math.ceil(total * RENDER_SR), RENDER_SR);
    const offMaster = off.createGain();
    offMaster.connect(off.destination);
    const offIr = makeImpulseResponse(off, 1.6, 3);
    const offDecks: Record<DeckId, DeckNodes> = {
      A: makeDeckNodes(off, offMaster, offIr),
      B: makeDeckNodes(off, offMaster, offIr),
    };

    this.scheduleParam(offDecks.A.cross.gain, this.automation, "crossfade", (x) => crossGainA(x ?? 0.5));
    this.scheduleParam(offDecks.B.cross.gain, this.automation, "crossfade", (x) => crossGainB(x ?? 0.5));

    // EQ / volume : chaîne partagée par deck (le snapshot t=0 pose la base), planifiée
    // une fois pour les decks ayant au moins un segment.
    const usedDecks = new Set(segments.map((s) => s.deck));
    for (const id of ["A", "B"] as DeckId[]) {
      if (!usedDecks.has(id)) continue;
      const n = offDecks[id];
      this.scheduleEq(n.eqLow.gain, this.automation, id, "low");
      this.scheduleEq(n.eqMid.gain, this.automation, id, "mid");
      this.scheduleEq(n.eqHigh.gain, this.automation, id, "high");
      this.scheduleVolume(n.volume.gain, this.automation, id);
      this.scheduleReverb(n.wet.gain, this.automation, id);
    }

    // Une source par segment (un même deck peut en enchaîner plusieurs).
    for (const seg of segments) {
      const n = offDecks[seg.deck];
      const src = off.createBufferSource();
      src.buffer = seg.buffer;
      src.connect(n.eqLow);
      src.playbackRate.setValueAtTime(seg.rate, seg.t);
      for (const r of seg.ratesInWindow) src.playbackRate.setValueAtTime(r.rate, r.t); // un pitch = un palier
      src.start(seg.t, seg.offset);
      if (seg.cutAt != null) src.stop(seg.cutAt);
    }

    const rendered = await off.startRendering();

    let blob: Blob;
    let mime: string;
    let ext: "mp3" | "wav";
    try {
      blob = await encodeMp3(rendered);
      mime = "audio/mpeg";
      ext = "mp3";
    } catch {
      blob = encodeWav(rendered);
      mime = "audio/wav";
      ext = "wav";
    }

    const tracklist = segments.map((seg, i) => ({
      pos: i + 1,
      artist: seg.track.artist,
      title: seg.track.title,
      timestamp: Math.round(seg.t),
    }));

    return { blob, mime, ext, durationSec: Math.round(rendered.duration), tracklist };
  }

  /** Fin de lecture d'un segment (pitch variable) par simulation des paliers. */
  private segmentEnd(
    bufDur: number,
    offset: number,
    startT: number,
    initialRate: number,
    rates: { t: number; rate: number }[],
  ): number {
    let remaining = bufDur - offset;
    let t = startT;
    let curRate = initialRate;
    for (const r of rates) {
      const dt = r.t - t;
      const consumed = curRate * dt;
      if (consumed >= remaining) return t + remaining / curRate;
      remaining -= consumed;
      t = r.t;
      curRate = r.rate;
    }
    return t + remaining / curRate;
  }

  private scheduleParam(
    param: AudioParam,
    events: AutomationEvent[],
    type: AutomationEvent["type"],
    toValue: (x: number | undefined) => number,
  ): void {
    const pts = events.filter((e) => e.type === type).sort((a, b) => a.t - b.t);
    if (pts.length === 0) {
      param.setValueAtTime(toValue(undefined), 0);
      return;
    }
    param.setValueAtTime(toValue(pts[0]!.x), pts[0]!.t);
    for (let i = 1; i < pts.length; i++) {
      param.linearRampToValueAtTime(toValue(pts[i]!.x), pts[i]!.t);
    }
  }

  private scheduleEq(param: AudioParam, events: AutomationEvent[], deck: DeckId, band: EqBand): void {
    const pts = events
      .filter((e) => e.type === "eq" && e.deck === deck && e.band === band && e.gainDb != null)
      .sort((a, b) => a.t - b.t) as { t: number; gainDb: number }[];
    if (pts.length === 0) {
      param.setValueAtTime(0, 0);
      return;
    }
    param.setValueAtTime(pts[0]!.gainDb, pts[0]!.t);
    for (let i = 1; i < pts.length; i++) {
      param.linearRampToValueAtTime(pts[i]!.gainDb, pts[i]!.t);
    }
  }

  private scheduleVolume(param: AudioParam, events: AutomationEvent[], deck: DeckId): void {
    const pts = events
      .filter((e) => e.type === "volume" && e.deck === deck && e.volume != null)
      .sort((a, b) => a.t - b.t) as { t: number; volume: number }[];
    if (pts.length === 0) {
      param.setValueAtTime(1, 0);
      return;
    }
    param.setValueAtTime(pts[0]!.volume, pts[0]!.t);
    for (let i = 1; i < pts.length; i++) {
      param.linearRampToValueAtTime(pts[i]!.volume, pts[i]!.t);
    }
  }

  private scheduleReverb(param: AudioParam, events: AutomationEvent[], deck: DeckId): void {
    const pts = events
      .filter((e) => e.type === "reverb" && e.deck === deck && e.wet != null)
      .sort((a, b) => a.t - b.t) as { t: number; wet: number }[];
    if (pts.length === 0) {
      param.setValueAtTime(0, 0);
      return;
    }
    param.setValueAtTime(pts[0]!.wet, pts[0]!.t);
    for (let i = 1; i < pts.length; i++) {
      param.linearRampToValueAtTime(pts[i]!.wet, pts[i]!.t);
    }
  }

  dispose(): void {
    this.stopSource("A");
    this.stopSource("B");
    void this.ctx.close();
  }
}
