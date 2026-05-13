/* Couche d'emojis flottants (utilisée par le mode Watch). */

export function ensureFloatLayer() {
  let layer = document.getElementById("floatLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "floatLayer";
    layer.className = "float-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

export function floatEmoji(emoji, fromEl) {
  const layer = ensureFloatLayer();
  const rect = fromEl.getBoundingClientRect();
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = "float-emoji";
    span.textContent = emoji;
    span.style.left = `${rect.left + rect.width / 2 + (Math.random() * 40 - 20)}px`;
    span.style.top = `${rect.top}px`;
    span.style.setProperty("--dx", `${Math.random() * 80 - 40}px`);
    span.style.setProperty("--dy", `-${120 + Math.random() * 100}px`);
    span.style.setProperty("--dur", `${1.4 + Math.random() * 0.8}s`);
    layer.appendChild(span);
    setTimeout(() => span.remove(), 2400);
  }
}
