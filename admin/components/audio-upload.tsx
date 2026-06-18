"use client";

import { useState, useRef } from "react";
import { api, ApiError } from "@/lib/api";
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

export function AudioUpload({
  kind,
  targetId,
  hasAudio,
  onDone,
}: {
  kind: "episode" | "mix";
  targetId: string;
  hasAudio: boolean;
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
      toast("Audio téléversé ✓", "ok");
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
        {hasAudio ? "↻ Audio" : "⬆ Audio"}
      </button>
      {open && (
        <Modal title={`Téléverser l'audio (${kind === "episode" ? "podcast" : "mix"})`} onClose={() => (busy ? null : setOpen(false))}>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
            Formats : MP3, M4A, AAC, OGG, WAV. L&apos;envoi se fait directement vers S3.
          </p>
          <input ref={fileRef} type="file" accept="audio/*" disabled={busy} />
          {busy && (
            <div style={{ marginTop: 16 }}>
              <div style={{ height: 8, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", transition: "width 0.2s" }} />
              </div>
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>{progress}%</p>
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
