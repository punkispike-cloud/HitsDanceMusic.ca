/* Helper a11y pour modales : piège de focus (Tab/Shift+Tab) + inert sur l'arrière-plan,
   restauration du focus à la fermeture. Vanilla, sans dépendance.

   activateModalTrap(dialogEl, { closeBtn, previousFocus }) :
   - met header + main en inert (arrière-plan non focusable / ignoré par les AT) ;
   - met le focus sur closeBtn (ou le 1er focusable) ;
   - piège Tab/Shift+Tab à l'intérieur de dialogEl ;
   - retourne une fonction release() qui retire l'inert, débranche le piège et
     restaure le focus sur previousFocus. */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function activateModalTrap(dialogEl, { closeBtn, previousFocus } = {}) {
  const bg = Array.from(document.body.children).filter(
    (el) => el !== dialogEl && !el.contains(dialogEl)
  );
  // Met l'arrière-plan en inert (replis : aria-hidden si inert non supporté).
  const restoredAttrs = bg.map((el) => ({
    el,
    inert: el.hasAttribute("inert"),
    hidden: el.getAttribute("aria-hidden"),
  }));
  bg.forEach((el) => {
    el.setAttribute("inert", "");
    el.setAttribute("aria-hidden", "true");
  });

  const focusables = () =>
    Array.from(dialogEl.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );

  const onKeydown = (e) => {
    if (e.key !== "Tab") return;
    const list = focusables();
    if (!list.length) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !dialogEl.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialogEl.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };
  dialogEl.addEventListener("keydown", onKeydown);

  // Focus initial : bouton fermer si fourni, sinon 1er focusable.
  const target = closeBtn || focusables()[0];
  if (target && target.focus) target.focus();

  return function release() {
    dialogEl.removeEventListener("keydown", onKeydown);
    restoredAttrs.forEach(({ el, inert, hidden }) => {
      if (!inert) el.removeAttribute("inert");
      if (hidden === null) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", hidden);
    });
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  };
}
