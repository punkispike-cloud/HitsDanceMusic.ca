"use client";

import { useState, useRef } from "react";
import { api, ApiError } from "@/lib/api";
import { estimateBpm } from "@/lib/audio/bpm";
import { useToast } from "./toast";
import { Modal } from "./ui";

interface PresignResp {
  intentId: string;
  objectKey: string;
  uploadUrl: string;
  expiresIn: number;
}

/** PUT direct sur S3 via XHR (pour suivre la progression). */
function putToS3(url: string, file: File, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Échec réseau vers S3 (vérifier la config CORS du bucket)"));
    xhr.send(file);
  });
}

/** Lit la durée d'un fichier audio côté client. */
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const d = Number.isFinite(audio.duration) ? Math.round(audio.duration) : undefined;
        URL.revokeObjectURL(audio.src);
        resolve(d);
      };
      audio.onerror = () => resolve(undefined);
      audio.src = URL.createObjectURL(file);
    } catch {
      resolve(undefined);
    }
  });
}

/** Estime le BPM d'un fichier audio côté client (décodage via OfflineAudioContext,
 *  pas de lecture/geste requis). Best-effort : null en cas d'échec. */
async function analyzeBpm(file: File): Promise<number | null> {
  try {
    const data = await file.arrayBuffer();
    const Ctor: typeof OfflineAudioContext =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const ctx = new Ctor(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(data);
    return estimateBpm(buffer);
  } catch {
    return null;
  }
}

export function AudioUpload({
  kind,
  targetId,
  hasAudio,
  currentBpm,
  onDone,
}: {
  kind: "episode" | "mix" | "track" | "media";
  targetId: string;
  hasAudio: boolean;
  currentBpm?: number | null; // pistes : si vide, on auto-estime le BPM au téléversement
  onDone: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast("Choisis un fichier audio.", "warn");
      return;
    }
    const contentType = file.type || "audio/mpeg";
    setBusy(true);
    setProgress(0);
    try {
      const presign = await api.post<PresignResp>("/v1/admin/uploads/presign", {
        kind,
        contentType,
        sizeBytes: file.size,
      });
      await putToS3(presign.uploadUrl, file, contentType, setProgress);
      const durationSec = await readDuration(file);
      await api.post("/v1/admin/uploads/confirm", {
        intentId: presign.intentId,
        targetId,
        durationSec,
      });
      // Pistes sans BPM : estimer et enregistrer (best-effort, ne bloque pas le succès).
      let bpmMsg = "";
      if (kind === "track" && !currentBpm) {
        const bpm = await analyzeBpm(file);
        if (bpm) {
          try {
            await api.patch(`/v1/admin/library/${targetId}`, { bpm });
            bpmMsg = ` · BPM estimé : ${bpm}`;
          } catch {
            /* l'audio est en place ; l'échec du BPM n'est pas bloquant */
          }
        }
      }
      toast(`Audio téléversé${bpmMsg}`, "ok");
      setOpen(false);
      await onDone();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      toast(msg || "Échec du téléversement", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} type="button">
        {hasAudio ? <ReplaceIcon /> : <UploadIcon />}
        {hasAudio ? "Remplacer l'audio" : "Ajouter l'audio"}
      </button>
      {open && (
        <Modal title={`Téléverser l'audio (${kind === "episode" ? "podcast" : kind === "track" ? "piste" : kind === "media" ? "média" : "mix"})`} onClose={() => (busy ? null : setOpen(false))}>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
            Formats : MP3, M4A, AAC, OGG, WAV. L&apos;envoi se fait directement vers S3.
          </p>
          <label htmlFor="audio-upload-file" className="sr-only">
            Fichier audio à téléverser
          </label>
          <input id="audio-upload-file" ref={fileRef} type="file" accept="audio/*" disabled={busy} />
          {busy && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{ height: 8, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progression du téléversement"
              >
                <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", transition: "width 0.2s" }} />
              </div>
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }} aria-live="polite">{progress}%</p>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy} type="button">
              Annuler
            </button>
            <button className="btn btn-primary" onClick={start} disabled={busy} type="button">
              {busy ? "Envoi…" : "Téléverser"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* Icônes SVG inline (currentColor, 18x18, stroke ~1.75), décoratives. */
function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="m6 10 6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}
function ReplaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}
