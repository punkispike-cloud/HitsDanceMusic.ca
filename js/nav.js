/* Navigation : burger mobile, scroll indicators, smooth-scroll to hash sur
   index, marquage du lien actif, more-menu, reset géoloc. */

import { $, $$ } from "./util.js";

export function bindNav() {
  const header = $(".site-header");
  const navToggle = $("#navToggle");
  const primaryNav = $("#primary-nav");

  function setNavOpen(open) {
    if (!header || !navToggle || !primaryNav) return;
    header.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    document.body.style.overflow = open ? "hidden" : "";
  }

  if (navToggle && header && primaryNav) {
    navToggle.addEventListener("click", () => setNavOpen(!header.classList.contains("is-open")));
    primaryNav.querySelectorAll("a").forEach((link) =>
      link.addEventListener("click", () => setNavOpen(false))
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && header.classList.contains("is-open")) {
        setNavOpen(false); navToggle.focus();
      }
      if (e.key === "Tab" && header.classList.contains("is-open")) {
        const focusables = primaryNav.querySelectorAll('a, button, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!primaryNav.contains(document.activeElement) && document.activeElement !== navToggle) {
          e.preventDefault(); first.focus();
        }
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 900 && header.classList.contains("is-open")) setNavOpen(false);
    });
  }

  const updateScrolled = () => document.body.classList.toggle("is-scrolled", window.scrollY > 20);
  let scrollTicking = false;
  window.addEventListener("scroll", () => {
    if (scrollTicking) return;
    requestAnimationFrame(() => { updateScrolled(); scrollTicking = false; });
    scrollTicking = true;
  }, { passive: true });
  updateScrolled();

  const navSectionIds = ["animateurs", "horaire", "emissions", "contact"];
  const navSectionLinks = navSectionIds
    .map((id) => document.querySelector(`#primary-nav a[href$="#${id}"]`))
    .filter(Boolean);
  const navSections = navSectionIds.map((id) => document.getElementById(id)).filter(Boolean);

  if (navSectionLinks.length && navSections.length >= 2) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navSectionLinks.forEach((link) => {
          link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
        });
      });
    }, { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
    navSections.forEach((s) => navObserver.observe(s));
  }

  const staggerTargets = $$(".talent-card, .quick-strip-card");
  if (staggerTargets.length) {
    staggerTargets.forEach((el) => el.classList.add("stagger-ready"));
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    staggerTargets.forEach((el) => revealObserver.observe(el));
  }
}

export function markActiveNav() {
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const map = {
    "": "navAccueil",
    "index.html": "navAccueil",
    "animateurs.html": "navEquipe",
    "horaire.html": "navHoraire",
    "emissions.html": "navEmissions",
  };
  const id = map[path];
  if (id) document.getElementById(id)?.classList.add("active");
}

export function smoothScrollToHashOnIndex() {
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (path !== "" && path !== "index.html") return;
  document.querySelectorAll('#primary-nav a[href*="index.html#"], a.brand[href="index.html"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href") || "";
      const hashIdx = href.indexOf("#");
      if (a.classList.contains("brand")) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
        history.replaceState(null, "", location.pathname);
        return;
      }
      if (hashIdx === -1) return;
      const id = href.slice(hashIdx + 1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    });
  });
}

// loadWeatherFn injecté par main.js pour éviter cycle d'imports
let _reloadWeatherFn = () => {};
export function setResetGeoHook(fn) { if (fn) _reloadWeatherFn = fn; }

export function bindResetGeo() {
  const btn = document.getElementById("resetGeoBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    try { localStorage.removeItem("hr.weather.geo"); } catch { /* noop */ }
    _reloadWeatherFn();
    import("./toast.js").then(({ toast }) => toast("Localisation réinitialisée — nouvelle demande de position.", "ok"));
    const menu = document.getElementById("moreMenu");
    const trigger = document.getElementById("moreMenuBtn");
    if (menu && trigger) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }
  });
}

/* More menu (⋯) — contact & dédicaces */
export function bindMoreMenu() {
  const btn = document.getElementById("moreMenuBtn");
  const menu = document.getElementById("moreMenu");
  if (!btn || !menu) return;
  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("a, button, [role='menuitem']");
    first && first.focus({ preventScroll: true });
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener("pointerdown", (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || e.target === btn || btn.contains(e.target)) return;
    close();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); btn.focus(); }
  });
  menu.addEventListener("click", (e) => {
    const target = e.target.closest("a, button, [role='menuitem']");
    if (!target) return;
    setTimeout(close, 0);
  });
  menu.addEventListener("focusout", (e) => {
    if (menu.hidden) return;
    const next = e.relatedTarget;
    if (!next) return;
    if (menu.contains(next) || next === btn) return;
    close();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") close();
  });
}
