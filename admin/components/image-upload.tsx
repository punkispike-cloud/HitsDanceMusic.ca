"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "./toast";

interface PresignResp {
  intentId: string;
  objectKey: string;
  uploadUrl: string;
}

function putToS3(url: string, file: File, contentType: string) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Échec réseau S3 (CORS du bucket ?)"));
    xhr.send(file);
  });
}

/** Bouton « Téléverser une photo » : presign(cover) → PUT S3 → confirm →
    renvoie l'URL publique via onUploaded. */
export function ImageUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => ref.current?.click();

  const onChange = async () => {
    const file = ref.current?.files?.[0];
    if (!file) return;
    const contentType = file.type || "image/jpeg";
    setBusy(true);
    try {
      const presign = await api.post<PresignResp>("/v1/admin/uploads/presign", {
        kind: "cover",
        contentType,
        sizeBytes: file.size,
      });
      await putToS3(presign.uploadUrl, file, contentType);
      const res = await api.post<{ url: string }>("/v1/admin/uploads/confirm", {
        intentId: presign.intentId,
      });
      onUploaded(res.url);
      toast("Photo téléversée ✓", "ok");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      toast(msg || "Échec du téléversement", "error");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={onChange} />
      <button type="button" className="btn btn-sm btn-ghost" onClick={pick} disabled={busy}>
        {busy ? "Envoi…" : "⬆ Téléverser une photo"}
      </button>
    </>
  );
}
