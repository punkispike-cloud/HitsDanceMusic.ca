/* JSON-LD RadioStation injecté runtime (en complément du JSON-LD HTML). */

import { $ } from "./util.js";
import { STREAM_URL } from "./now-playing.js";

export function injectJsonLd() {
  if ($("#hr-jsonld")) return;
  const data = {
    "@context": "https://schema.org",
    "@type": "RadioStation",
    "name": "Hits Dance Music — La radio",
    "url": location.origin + "/",
    "logo": location.origin + "/assets/favicon.svg",
    "broadcastDisplayName": "Hits Dance Music",
    "broadcastTimezone": "America/Toronto",
    "inLanguage": "fr-CA",
    "genre": ["Dance", "House", "Hits"],
    "telephone": "+1-418-261-2886",
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
