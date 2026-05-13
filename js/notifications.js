/* Notifications navigateur quand un nouveau show commence. */

import { store, STORAGE } from "./store.js";
import { SLOT_TAGS, getCurrentSlot } from "./schedule.js";
import { toast } from "./toast.js";

async function ensureNotifPermission(silent = false) {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  if (silent) return false;
  const res = await Notification.requestPermission();
  return res === "granted";
}

function notifyShowChange(slot) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  const tag = SLOT_TAGS[slot.tag] || SLOT_TAGS.hitlist;
  try {
    new Notification(`Maintenant sur Hits Dance Music : ${slot.title}`, {
      body: `${slot.from}–${slot.to} · ${slot.host || tag.label}`,
      icon: "assets/favicon.svg",
      tag: "hr-show",
      silent: true,
    });
  } catch { /* noop */ }
}

export function checkSlotChange() {
  const slot = getCurrentSlot();
  if (!slot) return;
  const sig = `${slot.from}|${slot.title}`;
  const last = store.get(STORAGE.notifLastSlot, "");
  if (sig === last) return;
  store.set(STORAGE.notifLastSlot, sig);
  if (!last) return;
  if (store.get(STORAGE.notifShow, "0") === "1") notifyShowChange(slot);
  toast(`🎙 Place à : ${slot.title}`, "info", 5000);
}

export async function toggleShowNotifications() {
  const cur = store.get(STORAGE.notifShow, "0") === "1";
  if (cur) {
    store.set(STORAGE.notifShow, "0");
    toast("Notifications de show désactivées", "info");
    return;
  }
  const ok = await ensureNotifPermission();
  if (!ok) { toast("Permission refusée par le navigateur.", "warn"); return; }
  store.set(STORAGE.notifShow, "1");
  toast("Notifications de show activées 🔔", "ok");
}
