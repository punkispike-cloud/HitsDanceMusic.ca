/* Sync multi-onglets : si un onglet démarre la lecture, les autres pausent. */

import { getAudio, pausePlayback } from "./player.js";
import { toast } from "./toast.js";

export function initMultiTabSync() {
  if (!("BroadcastChannel" in window)) return;
  const audio = getAudio();
  let hrChannel = null;
  try {
    hrChannel = new BroadcastChannel("hitradio-sync");
    hrChannel.addEventListener("message", (e) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "play-claim" && audio && !audio.paused) {
        pausePlayback();
        toast("Lecture reprise dans un autre onglet", "info", 3500);
      }
    });
    if (audio && !audio.dataset.hrSyncBound) {
      audio.dataset.hrSyncBound = "1";
      audio.addEventListener("playing", () => {
        try { hrChannel?.postMessage({ type: "play-claim", ts: Date.now() }); } catch { /* noop */ }
      });
    }
  } catch (err) {
    console.warn("[HitRadio] BroadcastChannel error", err);
  }

  window.addEventListener("beforeunload", () => {
    try { hrChannel?.close(); } catch { /* noop */ }
  });
}
