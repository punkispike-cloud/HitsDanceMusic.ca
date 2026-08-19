"use client";

import { useEffect, useRef, type MouseEvent } from "react";

/* Waveform sur canvas : peaks calculés depuis l'AudioBuffer (canal gauche),
 *  playhead piloté de l'extérieur (progress en secondes). Clic = seek.
 *  SSR-safe : le dessin se fait dans un effet (client uniquement). */

function computePeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const len = data.length;
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(len / buckets));
  for (let b = 0; b < buckets; b++) {
    let max = 0;
    const base = b * per;
    for (let i = 0; i < per; i++) {
      const s = Math.abs(data[base + i] ?? 0);
      if (s > max) max = s;
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

export function Waveform({
  buffer,
  progress,
  onSeek,
  height = 72,
  color = "var(--line-2)",
  playedColor = "var(--accent)",
  loopStart = null,
  loopEnd = null,
}: {
  buffer: AudioBuffer | null;
  progress: number; // secondes
  onSeek: (pos: number) => void;
  height?: number;
  color?: string;
  playedColor?: string;
  /** Région de boucle active (s) — null = pas de surcouche. */
  loopStart?: number | null;
  loopEnd?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);

  // Recalcule les peaks quand le buffer change.
  useEffect(() => {
    peaksRef.current = buffer ? computePeaks(buffer, 1200) : null;
  }, [buffer]);

  // Redessine à chaque rendu (playhead bouge via rAF côté page).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const peaks = peaksRef.current;
    if (!peaks || !buffer) return;
    const mid = h / 2;
    const n = peaks.length;
    const barW = w / n;
    const playedX = buffer.duration > 0 ? (progress / buffer.duration) * w : 0;
    for (let i = 0; i < n; i++) {
      const x = i * barW;
      const amp = peaks[i]! * mid * 0.96;
      ctx.fillStyle = x < playedX ? playedColor : color;
      ctx.fillRect(x, mid - amp, Math.max(1, barW - 0.4), amp * 2);
    }
    // Surcouche de boucle : région translucide + bornes.
    if (loopStart != null && loopEnd != null && buffer.duration > 0) {
      const x1 = (loopStart / buffer.duration) * w;
      const x2 = (loopEnd / buffer.duration) * w;
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
      ctx.fillStyle = playedColor;
      ctx.fillRect(x1, 0, 1.5, h);
      ctx.fillRect(x2 - 1.5, 0, 1.5, h);
    }
  });

  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!buffer) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * buffer.duration);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      aria-label="Forme d'onde — cliquer pour déplacer la tête de lecture"
      role="img"
      style={{
        width: "100%",
        height,
        background: "var(--panel-2)",
        borderRadius: 8,
        cursor: buffer ? "pointer" : "default",
        display: "block",
        border: "1px solid var(--line-2)",
      }}
    />
  );
}
