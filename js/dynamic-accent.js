/* Extrait la couleur dominante de la pochette et l'expose en --dynamic-accent. */

const _coverColorCache = new Map();

function extractDominantColor(imgUrl) {
  return new Promise((resolve) => {
    if (!imgUrl) return resolve(null);
    if (_coverColorCache.has(imgUrl)) return resolve(_coverColorCache.get(imgUrl));
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        const size = 32;
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lum = (max + min) / 2;
          if (lum < 40 || lum > 230) continue;
          if (max - min < 30) continue; // trop gris
          const key = `${Math.round(r / 24)},${Math.round(g / 24)},${Math.round(b / 24)}`;
          const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          e.r += r; e.g += g; e.b += b; e.n++;
          buckets.set(key, e);
        }
        let best = null, bestN = 0;
        for (const e of buckets.values()) if (e.n > bestN) { bestN = e.n; best = e; }
        if (!best) return resolve(null);
        const color = `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`;
        _coverColorCache.set(imgUrl, color);
        resolve(color);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

export async function applyDynamicAccent(coverUrl) {
  const color = await extractDominantColor(coverUrl);
  if (!color) {
    document.documentElement.style.removeProperty("--dynamic-accent");
    return;
  }
  document.documentElement.style.setProperty("--dynamic-accent", color);
}
