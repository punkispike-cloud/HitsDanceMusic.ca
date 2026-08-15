/* JSON-LD RadioStation injecté runtime (en complément du JSON-LD HTML). */

import { $ } from "./util.js";
import { STREAM_URL } from "./now-playing.js";
import { BRAND } from "./brand.generated.js";

// "+1-418-261-2886" à partir des chiffres bruts de brand/<slug>.json (NA 11 chiffres).
const fmtPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 11 ? `+${d[0]}-${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : String(p || "");
};

export function injectJsonLd() {
  if ($("#hr-jsonld")) return;
  const data = {
    "@context": "https://schema.org",
    "@type": "RadioStation",
    "name": `${BRAND.name} — La radio`,
    "url": location.origin + "/",
    "logo": location.origin + "/assets/favicon.svg",
    "broadcastDisplayName": BRAND.name,
    "broadcastTimezone": "America/Toronto",
    "inLanguage": "fr-CA",
    "genre": ["Dance", "House", "Hits"],
    "telephone": fmtPhone(BRAND.contact.phone),
    "potentialAction": {
      "@type": "ListenAction",
      "target": STREAM_URL,
    },
  };
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.id = "hr-jsonld";
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}
