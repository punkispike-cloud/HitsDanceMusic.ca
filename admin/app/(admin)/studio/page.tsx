"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useArtists, useLibrary, useRequests } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Modal, Spinner, ErrorState, Empty } from "@/components/ui";
import { Waveform } from "@/components/waveform";
import { isEditorialAdmin, formatDuration, type Mix, type RequestStatus, type SongRequest, type Track } from "@/lib/types";
import { StudioEngine } from "@/lib/audio/studio-engine";
import { emptyDeck, type DeckId, type DeckState, type EqBand, type RenderResult, type TrackRef } from "@/lib/audio/types";

const DECKS: DeckId[] = ["A", "B"];
const PITCH_MIN = -20;
const PITCH_MAX = 20;

const REQ_LABEL: Partial<Record<RequestStatus, string>> = {
  new: "Nouvelle",
  read: "Lue",
  queued: "En file",
  played: "Jouée",
  ignored: "Ignorée",
};

function reqTimeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface PresignResp {
  intentId: string;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
}

function putBlob(url: string, blob: Blob, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`stockage ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Échec réseau vers le stockage (vérifier CORS R2)"));
    xhr.send(blob);
  });
}

function snapshot(eng: StudioEngine, deck: DeckId): DeckState {
  const s = eng.state[deck];
  return { ...s, eq: { ...s.eq } };
}

export default function StudioPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { data: library, error: libError, mutate: reloadLib } = useLibrary();
  const { data: artists } = useArtists();
  const { data: newReq, mutate: mutateNewReq, error: newReqErr } = useRequests("new");
  const { data: queuedReq, mutate: mutateQueuedReq, error: queuedReqErr } = useRequests("queued");
  const [reqBusy, setReqBusy] = useState<string | null>(null);
  const canHandleReq = user?.role === "animateur" || isEditorialAdmin(user?.role);

  const engineRef = useRef<StudioEngine | null>(null);
  const [decks, setDecks] = useState<Record<DeckId, DeckState>>({ A: emptyDeck(), B: emptyDeck() });
  const [crossfader, setCrossfaderState] = useState(0.5);
  const [, setTick] = useState(0);
  const [pickerFor, setPickerFor] = useState<DeckId | null>(null);
  const [rendering, setRendering] = useState(false);
  const [render, setRender] = useState<RenderResult | null>(null);
  const [pubOpen, setPubOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [pubProgress, setPubProgress] = useState(0);
  const [pubTitle, setPubTitle] = useState("");
  const [pubGenre, setPubGenre] = useState("");
  const [pubArtistId, setPubArtistId] = useState("");
  const downloadUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<Record<DeckId, HTMLInputElement | null>>({ A: null, B: null });
  const tapRef = useRef<Record<DeckId, number[]>>({ A: [], B: [] });

  // Création du moteur au montage (client-only).
  useEffect(() => {
    const eng = new StudioEngine();
    engineRef.current = eng;
    setDecks({ A: snapshot(eng, "A"), B: snapshot(eng, "B") });
    return () => {
      eng.dispose();
      engineRef.current = null;
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    };
  }, []);

  // Boucle rAF pour rafraîchir le playhead tant qu'un deck joue.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const eng = engineRef.current;
      if (eng && (eng.state.A.playing || eng.state.B.playing)) setTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sync = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    setDecks({ A: snapshot(eng, "A"), B: snapshot(eng, "B") });
    setCrossfaderState(eng.crossfader);
  }, []);

  const loadTrack = async (deck: DeckId, track: Track) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (!track.audioUrl) {
      toast("Cette piste n'a pas d'audio téléversé.", "warn");
      return;
    }
    try {
      const resp = await fetch(track.audioUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.arrayBuffer();
      const ref: TrackRef = {
        id: track.id,
        artist: track.artist,
        title: track.title,
        bpm: track.bpm,
        durationSec: track.durationSec,
        audioUrl: track.audioUrl,
        source: "library",
      };
      const { bpm } = await eng.load(deck, ref, data);
      if (bpm && !track.bpm) toast(`BPM estimé : ${bpm}`, "ok");
      setRender(null);
      sync();
      setPickerFor(null);
    } catch (e) {
      toast("Chargement impossible (CORS R2 ou réseau) : " + (e as Error).message, "error");
    }
  };

  const loadDisk = async (deck: DeckId, file: File) => {
    const eng = engineRef.current;
    if (!eng) return;
    try {
      const data = await file.arrayBuffer();
      const ref: TrackRef = {
        id: `disk-${Date.now()}`,
        artist: "Fichier local",
        title: file.name.replace(/\.[^.]+$/, ""),
        bpm: null,
        durationSec: null,
        audioUrl: null,
        source: "disk",
      };
      const { bpm } = await eng.load(deck, ref, data);
      if (bpm) toast(`BPM estimé : ${bpm}`, "ok");
      setRender(null);
      sync();
    } catch (e) {
      toast("Lecture du fichier impossible : " + (e as Error).message, "error");
    }
  };

  const onFileChange = (deck: DeckId, e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void loadDisk(deck, f);
    e.target.value = "";
  };

  const onPlay = (deck: DeckId) => {
    if (engineRef.current) void engineRef.current.play(deck).then(sync);
  };
  const onStop = (deck: DeckId) => {
    engineRef.current?.stop(deck);
    sync();
  };
  const onSeek = (deck: DeckId, pos: number) => {
    if (engineRef.current) void engineRef.current.seek(deck, pos).then(sync);
  };
  const onRate = (deck: DeckId, pct: number) => {
    engineRef.current?.setRate(deck, 1 + pct / 100);
    sync();
  };
  const onEq = (deck: DeckId, band: EqBand, db: number) => {
    engineRef.current?.setEq(deck, band, db);
    sync();
  };
  const onVol = (deck: DeckId, v: number) => {
    engineRef.current?.setVolume(deck, v);
    sync();
  };
  const onReverb = (deck: DeckId, v: number) => {
    engineRef.current?.setReverb(deck, v);
    sync();
  };
  const onSetBpm = (deck: DeckId, bpm: number) => {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    engineRef.current?.setBpm(deck, bpm);
    sync();
  };
  const onReanalyze = (deck: DeckId) => {
    const bpm = engineRef.current?.reanalyzeBpm(deck);
    sync();
    toast(bpm ? `BPM ré-estimé : ${bpm}` : "Analyse BPM impossible", bpm ? "ok" : "warn");
  };
  // Tap tempo : médiane des intervalles entre frappes (réinitialisé après 2 s de pause).
  const onTap = (deck: DeckId) => {
    const now = performance.now();
    const arr = tapRef.current[deck];
    if (arr.length && now - arr[arr.length - 1]! > 2000) arr.length = 0;
    arr.push(now);
    if (arr.length > 8) arr.shift();
    if (arr.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < arr.length; i++) intervals.push(arr[i]! - arr[i - 1]!);
      intervals.sort((a, b) => a - b);
      const med = intervals[Math.floor(intervals.length / 2)]!;
      const bpm = 60000 / med;
      if (bpm >= 40 && bpm <= 300) {
        engineRef.current?.setBpm(deck, bpm);
        sync();
      }
    }
  };
  const onCross = (x: number) => {
    engineRef.current?.setCrossfader(x);
    sync();
  };
  const onSyncB = () => {
    engineRef.current?.syncBtoA();
    sync();
  };

  // File de demandes temps-réel : marquer une demande lu / en file / jouée /
  // ignorée (même PATCH que /demandes). Revalide les deux vues (new + queued).
  const setRequestStatus = async (id: string, status: RequestStatus) => {
    setReqBusy(id);
    try {
      await api.patch(`/v1/admin/requests/${id}`, { status });
      await Promise.all([mutateNewReq(), mutateQueuedReq()]);
      toast(`${REQ_LABEL[status] ?? status} ✓`, "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setReqBusy(null);
    }
  };

  const onReset = () => {
    engineRef.current?.resetAutomation();
    setRender(null);
    sync();
  };

  const doRender = async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setRendering(true);
    try {
      const r = await eng.render();
      setRender(r);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = URL.createObjectURL(r.blob);
      toast(`Mix rendu : ${formatDuration(r.durationSec)} (${r.ext.toUpperCase()})`, "ok");
    } catch (e) {
      toast((e as Error).message || "Échec du rendu", "error");
    } finally {
      setRendering(false);
    }
  };

  const openPublish = () => {
    if (!render) return;
    setPubTitle(`Studio mix — ${new Date().toLocaleString("fr-CA")}`);
    setPubGenre("");
    setPubArtistId(user?.artistId ?? artists?.[0]?.id ?? "");
    setPubOpen(true);
  };

  const doPublish = async () => {
    if (!render) return;
    if (!pubTitle.trim()) {
      toast("Titre requis", "warn");
      return;
    }
    const isAdmin = isEditorialAdmin(user?.role);
    const artistId = isAdmin ? pubArtistId : user?.artistId;
    if (!artistId) {
      toast("Artiste requis (crée un animateur d'abord).", "warn");
      return;
    }
    setPublishing(true);
    setPubProgress(0);
    try {
      const mix = await api.post<Mix>("/v1/admin/mixes", {
        title: pubTitle.trim(),
        genre: pubGenre.trim() || null,
        artistId,
        tracklist: render.tracklist,
        status: "draft",
      });
      const presign = await api.post<PresignResp>("/v1/admin/uploads/presign", {
        kind: "mix",
        contentType: render.mime,
        sizeBytes: render.blob.size,
      });
      await putBlob(presign.uploadUrl, render.blob, render.mime, setPubProgress);
      await api.post("/v1/admin/uploads/confirm", {
        intentId: presign.intentId,
        targetId: mix.id,
        durationSec: render.durationSec,
      });
      toast("Mix publié (brouillon) — visible dans /mixes.", "ok");
      setPubOpen(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      toast(msg || "Échec de la publication", "error");
    } finally {
      setPublishing(false);
    }
  };

  const downloadRender = () => {
    if (!downloadUrlRef.current || !render) return;
    const a = document.createElement("a");
    a.href = downloadUrlRef.current;
    a.download = `${pubTitle || "studio-mix"}.${render.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const eng = engineRef.current;
  const posA = eng ? eng.deckPosition("A") : 0;
  const posB = eng ? eng.deckPosition("B") : 0;
  const libTracks = (library ?? []).filter((t) => t.audioUrl);

  return (
    <div>
      <div className="page-head">
        <h1>Studio DJ</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onReset}>
            Réinitialiser
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void doRender()} disabled={rendering}>
            {rendering ? "Rendu en cours…" : "Rendre le mix (MP3)"}
          </button>
        </div>
      </div>

      <p className="muted" style={{ maxWidth: 760, marginBottom: 16, fontSize: "0.9rem" }}>
        Charge une piste par deck (bibliothèque ou ordinateur), lance la lecture, mixe au crossfader,
        ajuste le pitch/EQ. « Rendre le mix » fige ta performance en un fichier (Web Audio → MP3) que tu
        peux publier comme mix ou télécharger. 100% dans le navigateur.
      </p>

      {libError ? (
        <ErrorState
          message={(libError as ApiError).message || "Bibliothèque indisponible."}
          onRetry={() => void reloadLib()}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          <DeckPanel
            deck="A"
            state={decks.A}
            position={posA}
            effectiveBpm={eng?.effectiveBpm("A") ?? null}
            onPlay={() => onPlay("A")}
            onStop={() => onStop("A")}
            onSeek={(p) => onSeek("A", p)}
            onRate={(pct) => onRate("A", pct)}
            onEq={(band, db) => onEq("A", band, db)}
            onVol={(v) => onVol("A", v)}
            onReverb={(v) => onReverb("A", v)}
            onTap={() => onTap("A")}
            onReanalyze={() => onReanalyze("A")}
            onSetBpm={(b) => onSetBpm("A", b)}
            onPickLibrary={() => setPickerFor("A")}
            onPickDisk={() => fileInputRef.current.A?.click()}
            fileInputRef={(el) => {
              fileInputRef.current.A = el;
            }}
            onFileChange={(e) => onFileChange("A", e)}
          />

          <Crossfader value={crossfader} onChange={onCross} onSyncB={onSyncB} />

          <DeckPanel
            deck="B"
            state={decks.B}
            position={posB}
            effectiveBpm={eng?.effectiveBpm("B") ?? null}
            onPlay={() => onPlay("B")}
            onStop={() => onStop("B")}
            onSeek={(p) => onSeek("B", p)}
            onRate={(pct) => onRate("B", pct)}
            onEq={(band, db) => onEq("B", band, db)}
            onVol={(v) => onVol("B", v)}
            onReverb={(v) => onReverb("B", v)}
            onTap={() => onTap("B")}
            onReanalyze={() => onReanalyze("B")}
            onSetBpm={(b) => onSetBpm("B", b)}
            onPickLibrary={() => setPickerFor("B")}
            onPickDisk={() => fileInputRef.current.B?.click()}
            fileInputRef={(el) => {
              fileInputRef.current.B = el;
            }}
            onFileChange={(e) => onFileChange("B", e)}
          />
        </div>
      )}

      {user?.role !== "it" && (
        <section style={{ marginTop: 24 }}>
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Demandes en direct</h2>
            <span
              className="muted"
              style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                aria-hidden="true"
                style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }}
              />
              temps-réel (5 s)
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <RequestColumn
              title="Nouvelles"
              requests={newReq}
              loading={!newReq && !newReqErr}
              error={!!newReqErr}
              canHandle={canHandleReq}
              busy={reqBusy}
              onStatus={setRequestStatus}
              emptyHint="Aucune nouvelle demande."
            />
            <RequestColumn
              title="En file (on-air)"
              requests={queuedReq}
              loading={!queuedReq && !queuedReqErr}
              error={!!queuedReqErr}
              canHandle={canHandleReq}
              busy={reqBusy}
              onStatus={setRequestStatus}
              emptyHint="Rien en file pour l'instant."
            />
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 10 }}>
            File complète et historique dans <a href="/demandes">/demandes</a>.
          </p>
        </section>
      )}

      {(render || rendering) && (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--panel)" }}>
          <h2 style={{ marginTop: 0 }}>Rendu</h2>
          {render ? (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <span className="muted">
                  {formatDuration(render.durationSec)} · {render.ext.toUpperCase()} ·{" "}
                  {(render.blob.size / 1_048_576).toFixed(1)} Mo
                </span>
                <audio controls src={downloadUrlRef.current ?? undefined} style={{ height: 32 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={downloadRender}>
                    Télécharger
                  </button>
                  <button className="btn btn-primary btn-sm" type="button" onClick={openPublish}>
                    Publier comme mix
                  </button>
                </div>
              </div>
              <details>
                <summary style={{ cursor: "pointer", color: "var(--txt-dim)" }}>
                  Tracklist auto ({render.tracklist.length})
                </summary>
                <ol style={{ margin: "8px 0 0", paddingLeft: 24 }}>
                  {render.tracklist.map((t) => (
                    <li key={t.pos}>
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        [{fmt(t.timestamp)}]
                      </span>{" "}
                      {t.artist} — {t.title}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <p className="muted">Rendu en cours…</p>
          )}
        </div>
      )}

      {pickerFor && (
        <Modal title={`Charger une piste — Deck ${pickerFor}`} onClose={() => setPickerFor(null)}>
          {!library ? (
            <Spinner />
          ) : libTracks.length === 0 ? (
            <p className="muted">
              Aucune piste avec audio. Ajoute-en depuis <a href="/pistes">/pistes</a>.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 360, overflow: "auto" }}>
              {libTracks.map((t) => (
                <li key={t.id} style={{ padding: "8px 4px", borderBottom: "1px solid var(--line-2)" }}>
                  <button
                    className="btn btn-ghost"
                    style={{ width: "100%", textAlign: "left", justifyContent: "flex-start" }}
                    type="button"
                    onClick={() => void loadTrack(pickerFor, t)}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {t.artist} — {t.title}
                    </span>
                    <span className="muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>
                      {t.bpm ? `${Math.round(t.bpm)} BPM` : ""}{" "}
                      {t.durationSec ? `· ${formatDuration(t.durationSec)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {pubOpen && (
        <Modal title="Publier comme mix" onClose={() => (publishing ? null : setPubOpen(false))}>
          <Field label="Titre">
            <input
              type="text"
              value={pubTitle}
              onChange={(e) => setPubTitle(e.target.value)}
              disabled={publishing}
              aria-label="Titre du mix"
            />
          </Field>
          <Field label="Genre">
            <input
              type="text"
              value={pubGenre}
              onChange={(e) => setPubGenre(e.target.value)}
              placeholder="house, disco…"
              disabled={publishing}
              aria-label="Genre du mix"
            />
          </Field>
          <Field label="Animateur / DJ" hint="Le mix est signé par cet animateur (champ requis par la API).">
            {isEditorialAdmin(user?.role) ? (
              <select
                value={pubArtistId}
                onChange={(e) => setPubArtistId(e.target.value)}
                disabled={publishing}
                aria-label="Animateur / DJ"
              >
                <option value="">— choisir —</option>
                {(artists ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <input type="text" value={user?.displayName ?? ""} disabled aria-label="Animateur / DJ" />
            )}
          </Field>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            Créé en brouillon (audio attaché automatiquement). Publie-le ensuite depuis /mixes.
          </p>
          {publishing && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{ height: 8, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}
                role="progressbar"
                aria-valuenow={pubProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Envoi vers le stockage"
              >
                <div
                  style={{ height: "100%", width: `${pubProgress}%`, background: "var(--accent)", transition: "width 0.2s" }}
                />
              </div>
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }} aria-live="polite">
                Envoi vers le stockage… {pubProgress}%
              </p>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setPubOpen(false)} disabled={publishing}>
              Annuler
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void doPublish()} disabled={publishing}>
              {publishing ? "Publication…" : "Publier"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ───────────────────────── Sous-composants ───────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12, color: "var(--txt-dim)", marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function DeckPanel({
  deck,
  state,
  position,
  effectiveBpm,
  onPlay,
  onStop,
  onSeek,
  onRate,
  onEq,
  onVol,
  onReverb,
  onTap,
  onReanalyze,
  onSetBpm,
  onPickLibrary,
  onPickDisk,
  fileInputRef,
  onFileChange,
}: {
  deck: DeckId;
  state: DeckState;
  position: number;
  effectiveBpm: number | null;
  onPlay: () => void;
  onStop: () => void;
  onSeek: (pos: number) => void;
  onRate: (pct: number) => void;
  onEq: (band: EqBand, db: number) => void;
  onVol: (v: number) => void;
  onReverb: (v: number) => void;
  onTap: () => void;
  onReanalyze: () => void;
  onSetBpm: (bpm: number) => void;
  onPickLibrary: () => void;
  onPickDisk: () => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const pitchPct = (state.rate - 1) * 100;
  const dur = state.buffer?.duration ?? 0;
  const bpm = state.track?.bpm ?? null;
  // Phase de battement (0 = sur le beat) à partir de la position dans le buffer.
  // Pulse 1 sur le beat, décroît jusqu'au suivant. Rythme correct ; l'alignement
  // au kick dépend de la piste (anchré au début du buffer, pas détecté).
  const beatPulse = bpm && state.playing ? 1 - (((position * bpm) / 60) % 1) : 0;
  return (
    <div style={{ padding: 16, border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--panel)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 18 }}>Deck {deck}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BeatDot pulse={beatPulse} />
          {effectiveBpm && <span className="muted">{effectiveBpm} BPM</span>}
        </span>
      </div>

      <div style={{ marginBottom: 8, minHeight: 38 }}>
        {state.track ? (
          <div>
            <div style={{ fontWeight: 600 }}>{state.track.artist} — {state.track.title}</div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>
              {state.track.bpm ? `${Math.round(state.track.bpm)} BPM` : "BPM ?"}
              {state.track.key ? ` · ${state.track.key}` : ""} · {state.track.source === "library" ? "bibliothèque" : "disque"}
            </div>
          </div>
        ) : (
          <span className="muted">Aucune piste chargée</span>
        )}
      </div>

      <Waveform buffer={state.buffer} progress={position} onSeek={onSeek} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {fmt(position)} / {fmt(dur)}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm btn-primary" type="button" onClick={onPlay} disabled={!state.buffer}>
            ▶
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onStop} disabled={!state.buffer}>
            ■
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className="btn btn-sm btn-ghost" type="button" onClick={onPickLibrary} style={{ flex: 1 }}>
          Bibliothèque
        </button>
        <button className="btn btn-sm btn-ghost" type="button" onClick={onPickDisk} style={{ flex: 1 }}>
          Ordinateur
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={onFileChange}
          aria-label="Charger un fichier audio depuis l'ordinateur"
          style={{ display: "none" }}
        />
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "var(--txt-dim)" }}>BPM</span>
        <input
          type="number"
          min={40}
          max={300}
          step={1}
          value={bpm ? Math.round(bpm) : ""}
          onChange={(e) => onSetBpm(Number(e.target.value))}
          disabled={!state.track}
          aria-label={`BPM deck ${deck}`}
          style={{ width: 70 }}
        />
        <button className="btn btn-sm btn-ghost" type="button" onClick={onTap} disabled={!state.track} title="Taper le tempo">
          Tap
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={onReanalyze}
          disabled={!state.buffer}
          title="Ré-estimer le BPM depuis l'audio"
        >
          Auto
        </button>
      </div>

      <LabeledRange
        label="Pitch"
        valueLabel={`${pitchPct > 0 ? "+" : ""}${pitchPct.toFixed(1)}%`}
        min={PITCH_MIN}
        max={PITCH_MAX}
        step={0.1}
        value={pitchPct}
        onChange={onRate}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, margin: "12px 0" }}>
        {(["low", "mid", "high"] as EqBand[]).map((band) => (
          <EqControl
            key={band}
            band={band}
            value={state.eq[band]}
            onChange={(db) => onEq(band, db)}
          />
        ))}
      </div>

      <LabeledRange label="Volume" valueLabel={`${Math.round(state.volume * 100)}%`} min={0} max={1.2} step={0.01} value={state.volume} onChange={onVol} />

      <LabeledRange label="Reverb" valueLabel={`${Math.round(state.reverb * 100)}%`} min={0} max={0.9} step={0.01} value={state.reverb} onChange={onReverb} />
    </div>
  );
}

function BeatDot({ pulse }: { pulse: number }) {
  // pulse ∈ [0,1] : 1 sur le beat, décroît. Rendu uniquement via opacité/échelle
  // (rafraîchi par la boucle rAF de la page). Décoratif → aria-hidden.
  return (
    <span
      aria-hidden="true"
      title="Battement (au tempo)"
      style={{
        width: 11,
        height: 11,
        borderRadius: "50%",
        background: "var(--accent)",
        display: "inline-block",
        opacity: 0.2 + 0.8 * pulse,
        transform: `scale(${0.7 + 0.5 * pulse})`,
        transition: "opacity 0.06s linear, transform 0.06s linear",
      }}
    />
  );
}

function EqControl({ band, value, onChange }: { band: EqBand; value: number; onChange: (db: number) => void }) {
  const labels: Record<EqBand, string> = { low: "Low", mid: "Mid", high: "High" };
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--txt-dim)", marginBottom: 2 }}>{labels[band]}</div>
      <input
        type="range"
        min={-24}
        max={12}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        style={{ width: "100%", writingMode: "vertical-lr" as const, direction: "rtl", height: 80 }}
        aria-label={`EQ ${labels[band]}`}
      />
      <div className="muted" style={{ fontSize: "0.7rem" }}>
        {value > 0 ? "+" : ""}
        {value.toFixed(1)} dB
      </div>
    </div>
  );
}

function LabeledRange({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--txt-dim)", marginBottom: 2 }}>
        <span>{label}</span>
        <span>{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
        aria-label={label}
      />
    </div>
  );
}

function Crossfader({ value, onChange, onSyncB }: { value: number; onChange: (x: number) => void; onSyncB: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "16px 12px",
        border: "1px solid var(--line-2)",
        borderRadius: 12,
        background: "var(--panel)",
        minWidth: 120,
      }}
    >
      <strong style={{ fontSize: 12, color: "var(--txt-dim)", letterSpacing: 1 }}>CROSSFADER</strong>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: value < 0.5 ? "var(--accent)" : "var(--txt-dim)" }}>A</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: 120, writingMode: "vertical-lr" as const, height: 160 }}
          aria-label="Crossfader"
          aria-valuetext={`${Math.round(value * 100)}% vers B`}
        />
        <span style={{ color: value > 0.5 ? "var(--accent)" : "var(--txt-dim)" }}>B</span>
      </div>
      <button className="btn btn-sm btn-ghost" type="button" onClick={onSyncB} title="Aligner le BPM de B sur A">
        Sync B→A
      </button>
    </div>
  );
}

function RequestColumn({
  title,
  requests,
  loading,
  error,
  canHandle,
  busy,
  onStatus,
  emptyHint,
}: {
  title: string;
  requests: SongRequest[] | undefined;
  loading: boolean;
  error: boolean;
  canHandle: boolean;
  busy: string | null;
  onStatus: (id: string, status: RequestStatus) => void;
  emptyHint: string;
}) {
  return (
    <div style={{ padding: 16, border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--panel)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>{title}</strong>
        <span className="muted" style={{ fontSize: "0.8rem" }}>{requests?.length ?? 0}</span>
      </div>
      {error ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>File indisponible.</p>
      ) : loading ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>Chargement…</p>
      ) : !requests || requests.length === 0 ? (
        <Empty label={emptyHint} />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 320, overflow: "auto" }}>
          {requests.map((r) => (
            <li key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div className="muted" style={{ fontSize: "0.78rem" }}>{r.artist || "—"}</div>
              {r.dedication && (
                <div className="muted" style={{ fontSize: "0.78rem", fontStyle: "italic" }}>« {r.dedication} »</div>
              )}
              <div
                className="muted"
                style={{ fontSize: "0.72rem", display: "flex", justifyContent: "space-between", marginTop: 4 }}
              >
                <span>{r.requesterName || "Anonyme"}</span>
                <span title={new Date(r.createdAt).toLocaleString("fr-CA")}>{reqTimeAgo(r.createdAt)}</span>
              </div>
              {canHandle && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {r.status !== "read" && (
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy === r.id}
                      onClick={() => void onStatus(r.id, "read")}
                    >
                      Lu
                    </button>
                  )}
                  {r.status !== "queued" && (
                    <button
                      className="btn btn-sm"
                      disabled={busy === r.id}
                      onClick={() => void onStatus(r.id, "queued")}
                    >
                      En file
                    </button>
                  )}
                  {r.status !== "played" && (
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy === r.id}
                      onClick={() => void onStatus(r.id, "played")}
                    >
                      Jouée
                    </button>
                  )}
                  {r.status !== "ignored" && (
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy === r.id}
                      onClick={() => void onStatus(r.id, "ignored")}
                    >
                      Ignorer
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
