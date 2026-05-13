/* Toasts (aria-live polite). */

import { $ } from "./util.js";

function ensureToastHost() {
  let h = $("#toastHost");
  if (h) return h;
  h = document.createElement("div");
  h.id = "toastHost";
  h.className = "toast-host";
  h.setAttribute("role", "status");
  h.setAttribute("aria-live", "polite");
  document.body.appendChild(h);
  return h;
}

export function toast(msg, kind = "info", ms = 3500) {
  const host = ensureToastHost();
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("is-shown"));
  setTimeout(() => {
    t.classList.remove("is-shown");
    setTimeout(() => t.remove(), 350);
  }, ms);
}
