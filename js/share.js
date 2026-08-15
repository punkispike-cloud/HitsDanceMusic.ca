/* Partage du direct (navigator.share avec fallback presse-papiers). */

import { haptic } from "./util.js";
import { state } from "./state.js";
import { getCurrentSlot } from "./schedule.js";
import { BRAND } from "./brand.generated.js";
import { toast } from "./toast.js";

export async function shareCurrent() {
  haptic([8, 30, 8]);
  const slot = state.currentSlot || getCurrentSlot();
  const trackText = state.currentTrack
    ? (state.currentTrack.artist ? `${state.currentTrack.artist} — ${state.currentTrack.title}` : state.currentTrack.title)
    : slot.title;
  const text = `J'écoute « ${trackText} » sur ${BRAND.name} — La radio`;
  const url = `${location.origin}${location.pathname}?play=1#player`;
  if (navigator.share) {
    try { await navigator.share({ title: BRAND.name, text, url }); return; }
    catch { /* annulé */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Lien copié dans le presse-papiers !", "ok");
  } catch {
    toast("Partage non supporté sur ce navigateur.", "warn");
  }
}
