/* Picture-in-Picture audio (canvas → video → PiP). Web Audio inopérant
   sans CORS sur le flux, donc pas de barre viz dans la frame. */

import { state } from "./state.js";
import { getCurrentSlot } from "./schedule.js";
import { BRAND } from "./brand.generated.js";
import { toast } from "./toast.js";

let _pipVideo = null;
let _pipCanvas = null;
let _pipRAF = 0;

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = (text || "").split(" ");
  let line = "";
  for (const w of words) {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y);
      line = w + " ";
      y += lh;
    } else line = test;
  }
  ctx.fillText(line.trim(), x, y);
}

function drawPipFrame() {
  if (!_pipCanvas) return;
  const ctx = _pipCanvas.getContext("2d");
  const w = _pipCanvas.width, h = _pipCanvas.height;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1a0610");
  grad.addColorStop(1, "#06060a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  if (state.currentCover) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { try { ctx.drawImage(img, 20, 20, 230, 230); } catch { /* noop */ } };
    img.src = state.currentCover;
  } else {
    ctx.fillStyle = "#c8102e";
    ctx.fillRect(20, 20, 230, 230);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("HR", 135, 140);
  }
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("● LIVE", 270, 50);
  ctx.fillStyle = "#ff3a6e";
  const slot = state.currentSlot || getCurrentSlot();
  ctx.font = "bold 20px system-ui, sans-serif";
  wrapText(ctx, slot?.title || BRAND.name, 270, 90, 200, 24);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "16px system-ui, sans-serif";
  if (state.currentTrack?.title) {
    ctx.fillText(`♪ ${state.currentTrack.title.slice(0, 22)}`, 270, 200);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(state.currentTrack.artist?.slice(0, 24) || "", 270, 224);
  } else {
    ctx.fillText(slot?.host || "Programmation", 270, 200);
  }
  _pipRAF = requestAnimationFrame(drawPipFrame);
}

export async function togglePip() {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }
  if (!_pipCanvas) {
    _pipCanvas = document.createElement("canvas");
    _pipCanvas.width = 480; _pipCanvas.height = 270;
  }
  if (!_pipVideo) {
    _pipVideo = document.createElement("video");
    _pipVideo.muted = true;
    _pipVideo.playsInline = true;
    _pipVideo.srcObject = _pipCanvas.captureStream(30);
    _pipVideo.style.position = "fixed";
    _pipVideo.style.left = "-9999px";
    document.body.appendChild(_pipVideo);
    _pipVideo.addEventListener("leavepictureinpicture", () => {
      if (_pipRAF) { cancelAnimationFrame(_pipRAF); _pipRAF = 0; }
    });
    await _pipVideo.play().catch(() => {});
  }
  drawPipFrame();
  try {
    await _pipVideo.requestPictureInPicture();
    toast("Picture-in-Picture activé", "ok");
  } catch (e) {
    if (_pipRAF) { cancelAnimationFrame(_pipRAF); _pipRAF = 0; }
    toast("PiP non disponible sur ce navigateur", "warn");
  }
}
