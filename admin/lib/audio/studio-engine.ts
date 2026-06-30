/* StudioEngine : moteur Web Audio du studio de mix.
 *  - Live : 2 decks (source → EQ 3 bandes → volume → crossfade → master → out),
 *    crossfader equal-power, pitch (playbackRate), sync B→A.
 *  - Capture d'automation horodatée (temps transport) à chaque action utilisateur.
 *  - render() : replanifie la performance dans un OfflineAudioContext (44,1 kHz)
 *    → AudioBuffer → MP3 (lamejs) ou repli WAV → Blob + tracklist auto.
 *
 *  MVP : une lecture par deck dans le rendu (le dernier événement play gagne ;
 *  re-lancer un deck remplace sa contribution). Couvre le cas d'usage central :
 *  charger A, charger B, lancer A, crossfader vers B, lancer B. */

import { estimateBpm } from "./bpm";
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
  cross: GainNode;
}

function makeDeckNodes(ctx: BaseAudioContext, master: GainNode): DeckNodes {
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
  const cross = ctx.createGain();
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(volume);
  volume.connect(cross);
  cross.connect(master);
  return { source: null, eqLow, eqMid, eqHigh, volume, cross };
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
  private decks: Record<DeckId, DeckNodes>;
  state: Record<DeckId, DeckState>;
  automation: AutomationEvent[] = [];
  crossfader = 0.5;
  private transportStartCtx = 0;
  private started = false;

  constructor() {
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.decks = { A: makeDeckNodes(this.ctx, this.master), B: makeDeckNodes(this.ctx, this.master) };
    this.state = { A: emptyDeck(), B: emptyDeck() };
    this.applyCrossfader(0.5);
  }

  /* ───────────────────────── Chargement ───────────────────────── */

  async load(deckId: DeckId, track: TrackRef, data: ArrayBuffer): Promise<{ bpm: number | null }> {
    const buffer = await this.ctx.decodeAudioData(data.slice(0));
    const bpm = track.bpm ?? estimateBpm(buffer);
    this.state[deckId] = {
      ...this.state[deckId],
      loaded: true,
      track: { ...track, bpm },
      buffer,
      offset: 0,
    };
    this.applyEq(deckId);
    this.applyVolume(deckId);
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
    this.automation.push({ t: this.tNow(), type: "play", deck: deckId, offset: off, rate: d.rate });
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

  /** Réinitialise l'automation (nouveau set) sans décharger les decks. */
  resetAutomation(): void {
    this.automation = [];
    this.started = false;
    this.stop("A");
    this.stop("B");
  }

  /* ───────────────────────── Rendu ───────────────────────── */

  async render(): Promise<RenderResult> {
    const plays = this.automation
      .filter((e): e is AutomationEvent & { deck: DeckId; offset: number; rate?: number } =>
        e.type === "play" && !!e.deck && !!this.state[e.deck].buffer,
      )
      // Dernier play par deck (un deck = une source dans le rendu MVP).
      .filter((e, _i, arr) => e === arr.filter((p) => p.deck === e.deck).at(-1));

    if (plays.length === 0) throw new Error("Rien à rendre : charge une piste et lance la lecture.");

    // Durée totale = fin exacte du buffer le plus tardif (avec pitch variable).
    let total = 0;
    for (const p of plays) {
      const end = this.computeDeckEnd(p.deck, p.t, p.offset, p.rate ?? 1);
      total = Math.max(total, end);
    }
    total += 0.08; // queue

    const off = new OfflineAudioContext(2, Math.ceil(total * RENDER_SR), RENDER_SR);
    const offMaster = off.createGain();
    offMaster.connect(off.destination);
    const offA = makeDeckNodes(off, offMaster);
    const offB = makeDeckNodes(off, offMaster);
    const offDecks: Record<DeckId, DeckNodes> = { A: offA, B: offB };

    this.scheduleParam(offDecks.A.cross.gain, this.automation, "crossfade", (x) => crossGainA(x ?? 0.5));
    this.scheduleParam(offDecks.B.cross.gain, this.automation, "crossfade", (x) => crossGainB(x ?? 0.5));
    for (const id of ["A", "B"] as DeckId[]) {
      const n = offDecks[id];
      const d = this.state[id];
      if (!d.buffer) continue;
      // EQ / volume : on planifie tous les événements du deck (le snapshot t=0 pose la base).
      this.scheduleEq(n.eqLow.gain, this.automation, id, "low");
      this.scheduleEq(n.eqMid.gain, this.automation, id, "mid");
      this.scheduleEq(n.eqHigh.gain, this.automation, id, "high");
      this.scheduleVolume(n.volume.gain, this.automation, id);
      // Source + pitch.
      const play = plays.find((p) => p.deck === id)!;
      const src = off.createBufferSource();
      src.buffer = d.buffer;
      src.connect(n.eqLow);
      this.scheduleRate(src.playbackRate, this.automation, id, play.t, play.rate ?? d.rate);
      src.start(play.t, play.offset);
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

    const tracklist = plays
      .slice()
      .sort((a, b) => a.t - b.t)
      .map((p, i) => {
        const tr = this.state[p.deck].track!;
        return { pos: i + 1, artist: tr.artist, title: tr.title, timestamp: Math.round(p.t) };
      });

    return { blob, mime, ext, durationSec: Math.round(rendered.duration), tracklist };
  }

  /** Fin exacte de lecture d'un deck (pitch variable) par simulation des paliers. */
  private computeDeckEnd(deckId: DeckId, playT: number, offset: number, initialRate: number): number {
    const bufDur = this.state[deckId].buffer!.duration;
    const rates = this.automation
      .filter((e) => e.type === "pitch" && e.deck === deckId && e.t >= playT && e.rate != null)
      .sort((a, b) => a.t - b.t) as { t: number; rate: number }[];
    let remaining = bufDur - offset;
    let t = playT;
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

  private scheduleRate(
    param: AudioParam,
    events: AutomationEvent[],
    deck: DeckId,
    playT: number,
    initialRate: number,
  ): void {
    param.setValueAtTime(initialRate, playT);
    const pts = events
      .filter((e) => e.type === "pitch" && e.deck === deck && e.t > playT && e.rate != null)
      .sort((a, b) => a.t - b.t) as { t: number; rate: number }[];
    for (const p of pts) {
      param.setValueAtTime(p.rate, p.t); // changement en marche (pas de rampe : un pitch est un palier)
    }
  }

  dispose(): void {
    this.stopSource("A");
    this.stopSource("B");
    void this.ctx.close();
  }
}
