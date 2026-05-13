/* Wrapper localStorage tolérant aux modes privés (Safari) + clés utilisées. */

export const STORAGE = {
  vol: "hr.volume",
  mute: "hr.mute",
  playing: "hr.wasPlaying",
  history: "hr.history",
  resume: "hr.resumeOk",
  favs: "hr.favs",
  notifShow: "hr.notifShow",
  notifLastSlot: "hr.notifLastSlot",
  stats: "hr.stats",
};

export const store = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : v; }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* noop */ } },
  getJSON(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } },
};
