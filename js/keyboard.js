/* Raccourcis clavier globaux — un seul listener consolidé.
   Touches : Espace / ↑↓ / M / H / L / W / P / ? / Ctrl+K. */

import { getAudio, setVolume, toggleMute, togglePlayback } from "./player.js";

// Hooks optionnels (câblés par main.js après chargement dynamique des panneaux)
let _toggleHistory = () => {};
let _toggleLyrics  = () => {};
let _openWatch     = () => {};
let _togglePip     = () => {};
let _toggleShortcuts = () => {};
let _openSearch    = () => {};

export function setKeyboardHooks(hooks) {
  if (hooks.toggleHistory)  _toggleHistory  = hooks.toggleHistory;
  if (hooks.toggleLyrics)   _toggleLyrics   = hooks.toggleLyrics;
  if (hooks.openWatch)      _openWatch      = hooks.openWatch;
  if (hooks.togglePip)      _togglePip      = hooks.togglePip;
  if (hooks.toggleShortcuts) _toggleShortcuts = hooks.toggleShortcuts;
  if (hooks.openSearch)     _openSearch     = hooks.openSearch;
}

export function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || e.target?.isContentEditable) return;
    if (e.metaKey || e.altKey) return;
    // Ctrl+K : palette de recherche
    if (e.ctrlKey) {
      if (e.key === "k" || e.key === "K") { e.preventDefault(); _openSearch(); }
      return;
    }
    const audio = getAudio();
    switch (e.key) {
      case " ":
        e.preventDefault(); void togglePlayback(); break;
      case "ArrowUp":
        e.preventDefault(); setVolume((audio?.volume ?? 0.85) + 0.05); break;
      case "ArrowDown":
        e.preventDefault(); setVolume((audio?.volume ?? 0.85) - 0.05); break;
      case "m":
      case "M":
        e.preventDefault(); toggleMute(); break;
      case "h":
      case "H":
        e.preventDefault(); _toggleHistory(); break;
      case "l":
      case "L":
        e.preventDefault(); _toggleLyrics(); break;
      case "w":
      case "W":
        e.preventDefault(); _openWatch(); break;
      case "p":
      case "P": {
        const mini = document.getElementById("miniPlayer");
        if (mini && mini.classList.contains("is-hidden")) {
          mini.classList.remove("is-hidden");
          mini.classList.add("is-shown");
          sessionStorage.removeItem("hr.miniHidden");
        } else {
          _togglePip();
        }
        break;
      }
      case "?":
        _toggleShortcuts();
        break;
    }
  });
}
