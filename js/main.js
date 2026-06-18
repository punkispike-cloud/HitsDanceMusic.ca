/* Hits Dance Music — point d'entrée modules ES.
   Orchestre l'initialisation en deux phases :
     1) critique (synchrone)  — header, player, nav, audio ready
     2) idle (requestIdleCallback) — features secondaires, intervals longs
   Chargé via <script type="module" src="js/main.js"> sur toutes les pages. */

import { $, $$ } from "./util.js";
import { store, STORAGE } from "./store.js";
import { ensureLiveRegion, ensureSkipLink, announce } from "./a11y.js";
import { applyTheme, initThemeWatchers } from "./theme.js";

import {
  ensureAudio, bindAudioEvents, applyVolumeFromStore,
  renderOnAir, renderClock, refreshLiveTrack,
  startPlayback, bindVisibilityResume, setAnnounceTrackHook,
  playerUIs,
} from "./player.js";
import {
  makeFullPanelUI, makeMiniPlayerUI, injectHeaderPlay,
  injectSleepBadge, injectSessionBadgeHost, setMiniHooks,
} from "./player-ui.js";

import { bindNav, markActiveNav, smoothScrollToHashOnIndex, bindResetGeo, bindMoreMenu, setResetGeoHook } from "./nav.js";
import { wireInstallButtons } from "./install-pwa.js";
import { bindContactForm } from "./contact-form.js";
import { buildScheduleTable, downloadIcs, loadScheduleFromApi } from "./schedule.js";
import { renderHistory, toggleHistory, injectHistorySearch } from "./history-drawer.js";
import { shareCurrent } from "./share.js";

import { bindConnectivity } from "./connectivity.js";
import { injectJsonLd } from "./seo.js";
import { annotateTalentCards } from "./animateurs.js";
import { loadContentFromApi } from "./content.js";
import { renderCountdown } from "./countdown.js";
import { startStatsTracking, renderStatsPage } from "./stats.js";
import { injectFavButtons, injectFavFilter } from "./favorites.js";
import { handleDeepLinks } from "./deep-links.js";
import { checkSlotChange, toggleShowNotifications } from "./notifications.js";

import { renderAllRails, renderRailUpcoming } from "./rails.js";
import { loadWeather } from "./weather.js";
import { injectBottomNav } from "./bottom-nav.js";

import { initUiExtras, initPhase2UX } from "./ui-extras.js";
import { initMultiTabSync } from "./multi-tab.js";

import { initPresence } from "./presence.js";
import { initAnalytics } from "./analytics.js";
import { registerSW } from "./sw-register.js";

import { bindKeyboard, setKeyboardHooks } from "./keyboard.js";
import { openSearch, setSearchHooks } from "./search-palette.js";
import { openWatch, injectWatchButton } from "./watch.js";
import { toggleLyrics, tickLyrics } from "./lyrics.js";
import { togglePip } from "./pip.js";
import { toggleShortcuts } from "./shortcuts-help.js";
import { applyDynamicAccent } from "./dynamic-accent.js";
import { state } from "./state.js";

/* requestIdleCallback avec fallback setTimeout pour Safari < 17.4. */
const idle = (cb) => ("requestIdleCallback" in window
  ? window.requestIdleCallback(cb, { timeout: 2000 })
  : setTimeout(cb, 50));

/* setInterval avec deux modes :
   - { keepFresh: false } (défaut) → pausé quand l'onglet est caché.
     Pour les rafraîchissements purement visuels (horloge, compte à rebours,
     météo, paroles…) : 0 utilité quand personne ne regarde, économie CPU.
   - { keepFresh: true } → continue de tourner même onglet caché.
     Indispensable pour ce qui alimente MediaSession (contrôles système /
     lock screen) ou émet des notifications natives — sinon l'auditeur en
     arrière-plan voit des métadonnées figées et rate les changements
     d'émission. L'audio lui-même n'a JAMAIS été affecté par bgInterval ;
     <audio> joue indépendamment des timers. */
function bgInterval(fn, ms, { keepFresh = false } = {}) {
  let id = 0;
  function start() { if (!id) id = window.setInterval(fn, ms); }
  function stop() { if (id) { clearInterval(id); id = 0; } }
  if (keepFresh) {
    // Refresh immédiat quand on revient sur l'onglet, mais on ne pause pas
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { try { fn(); } catch { /* noop */ } }
    });
    start();
    return;
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      start();
      try { fn(); } catch { /* noop */ }
    } else {
      stop();
    }
  });
  start();
}

function initCritical() {
  // a11y : skip link et région live AVANT injection des panneaux
  ensureSkipLink();
  ensureLiveRegion();
  setAnnounceTrackHook((np) => {
    if (!np || !np.title) return;
    announce(`Maintenant : ${np.artist ? np.artist + " — " : ""}${np.title}`);
  });

  // Header partagé : play button, sleep badge, more-menu, install délégué
  injectHeaderPlay();
  injectSleepBadge();
  injectSessionBadgeHost();
  bindMoreMenu();
  setResetGeoHook(() => { void loadWeather(); });
  wireInstallButtons();

  // Player audio + UI
  ensureAudio();
  bindAudioEvents();
  const fullUI = makeFullPanelUI();
  if (fullUI) playerUIs.add(fullUI);
  const miniUI = makeMiniPlayerUI();
  if (miniUI) playerUIs.add(miniUI);
  setMiniHooks({ openHistory: () => toggleHistory(), share: shareCurrent });

  applyVolumeFromStore();
  renderOnAir();
  renderClock();
  bgInterval(renderClock, 30_000);
  // renderOnAir met à jour MediaSession (titre de l'émission affiché sur le
  // lock screen / contrôles système) → garder frais même onglet caché.
  bgInterval(renderOnAir, 30_000, { keepFresh: true });
  bindVisibilityResume();

  // Auto-resume si l'utilisateur écoutait avant nav, ou ?play=1
  const autoplayParam = new URLSearchParams(location.search).get("play") === "1";
  const wasPlaying = store.get(STORAGE.playing, "0") === "1";
  if (autoplayParam || wasPlaying) {
    requestAnimationFrame(() => {
      $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
      void startPlayback();
      if (autoplayParam) {
        try {
          const u = new URL(location.href);
          u.searchParams.delete("play");
          history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
        } catch { /* noop */ }
      }
    });
  }

  // Liens "Écouter sur la page" / "Écouter le direct"
  $("#listenOnPage")?.addEventListener("click", async (e) => {
    e.preventDefault();
    $("#player")?.scrollIntoView({ behavior: "smooth", block: "center" });
    await startPlayback();
    $("#playToggle")?.focus({ preventScroll: true });
  });
  $$(".listen-strip-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      void startPlayback();
    });
  });

  // Nav, contact form, ICS, history
  bindNav();
  markActiveNav();
  smoothScrollToHashOnIndex();
  bindResetGeo();
  bindContactForm();
  buildScheduleTable();
  // Tente de remplacer la grille hardcodée par celle de l'API (admin-éditable).
  // Rendu instantané avec le fallback ci-dessus, puis re-render si l'API répond.
  void loadScheduleFromApi().then((updated) => {
    if (!updated) return;
    buildScheduleTable();
    renderOnAir();
  });
  $("#downloadIcs")?.addEventListener("click", (e) => { e.preventDefault(); downloadIcs(); });
  $("#openHistoryBtn")?.addEventListener("click", (e) => { e.preventDefault(); toggleHistory(true); });
  renderHistory();

  // Thème — verrouillé en sombre (bootstrap déjà fait par theme-init.js)
  applyTheme();
  initThemeWatchers();

  // Tracking stats au premier play
  const audio = ensureAudio();
  audio.addEventListener("play", () => { startStatsTracking(); }, { once: true });

  // Now playing — démarre tôt pour avoir le morceau courant.
  // keepFresh: alimente MediaSession (contrôles système / lock screen),
  // donc on continue de fetcher même quand l'onglet est en arrière-plan,
  // sinon l'auditeur en background voit un titre figé.
  void refreshLiveTrack();
  bgInterval(refreshLiveTrack, 25_000, { keepFresh: true });

  // Raccourcis clavier (un seul listener consolidé)
  setKeyboardHooks({
    toggleHistory: () => toggleHistory(),
    toggleLyrics:  () => toggleLyrics(),
    openWatch:     () => openWatch(),
    togglePip:     () => void togglePip(),
    toggleShortcuts: () => toggleShortcuts(),
    openSearch:    () => openSearch(),
  });
  bindKeyboard();
}

function initIdle() {
  // Connectivité, SEO runtime, animateurs, countdown
  bindConnectivity();
  injectJsonLd();
  annotateTalentCards();
  // Branche animateurs/émissions sur l'API (visuel identique, fallback HTML).
  // Re-rend puis ré-annote les cartes animateurs avec leur prochain passage.
  void loadContentFromApi().then((touchedTalent) => {
    if (touchedTalent) annotateTalentCards();
  });
  renderCountdown();
  bgInterval(renderCountdown, 30_000);

  // Favoris, history search, deep links, stats page
  injectFavButtons();
  injectFavFilter();
  injectHistorySearch();
  handleDeepLinks();
  renderStatsPage();

  // Notifs : check le slot toutes les minutes.
  // keepFresh: la notif "Place à : Hit Drive" doit pouvoir s'afficher même
  // quand l'utilisateur a l'onglet caché (c'est précisément le cas d'usage).
  checkSlotChange();
  bgInterval(checkSlotChange, 60_000, { keepFresh: true });

  // Rails, météo, bottom nav, watch
  renderAllRails();
  bgInterval(renderRailUpcoming, 60_000);
  loadWeather();
  bgInterval(loadWeather, 10 * 60_000);
  injectBottomNav();
  injectWatchButton();

  // Tick paroles + couleur dynamique : seulement quand un panneau lyrics
  // est ouvert OU une cover dynamique est posée → throttle via vis check.
  bgInterval(() => {
    tickLyrics();
    if (state.currentCover) void applyDynamicAccent(state.currentCover);
  }, 1000);

  // UX extras (ticker, back-to-top, scroll-reveal, skeletons, vinyl cursor)
  initUiExtras();
  initPhase2UX();

  // Multi-onglets : pause les autres quand un démarre
  initMultiTabSync();

  // Hooks pour la palette de recherche (actions secondaires)
  setSearchHooks({
    toggleNotif:  () => void toggleShowNotifications(),
    openWatch:    () => openWatch(),
    toggleLyrics: () => toggleLyrics(),
    togglePip:    () => void togglePip(),
  });

  // Service worker (PWA shell) + Compteur live (WS) + Analytics d'audience
  registerSW();
  initPresence();
  initAnalytics();
}

function boot() {
  initCritical();
  // Différer le non-critique pour libérer le main thread pendant le rendu initial
  idle(initIdle);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
