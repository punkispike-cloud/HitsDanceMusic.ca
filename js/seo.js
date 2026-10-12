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
  const base = location.origin + "/";
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RadioStation",
        "name": `${BRAND.name} — La radio`,
        "url": base,
        "logo": location.origin + "/assets/favicon.svg",
        "broadcastDisplayName": BRAND.name,
        "broadcastTimezone": "America/Toronto",
        "inLanguage": "fr-CA",
        "genre": ["Dance", "House", "Hits"],
        "telephone": fmtPhone(BRAND.contact.phone),
        "potentialAction": { "@type": "ListenAction", "target": STREAM_URL },
      },
      {
        "@type": "BroadcastService",
        "name": `${BRAND.name} — Direct`,
        "broadcastDisplayName": BRAND.name,
        "broadcastTimezone": "America/Toronto",
        "inLanguage": "fr-CA",
        "broadcastAffiliateOf": { "@type": "RadioStation", "name": `${BRAND.name} — La radio` },
        "potentialAction": { "@type": "ListenAction", "target": `${base}#player` },
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Comment écouter Hits Dance Music en direct ?",
            "acceptedAnswer": { "@type": "Answer", "text": "Clique sur Écouter le direct sur hitsdancemusic.ca, ou ajoute la radio à ton écran d’accueil via Installer l’app. Flux MP3 192 kbps compatible mobile, voiture et enceintes." },
          },
          {
            "@type": "Question",
            "name": "Où voir la grille des émissions 2026 ?",
            "acceptedAnswer": { "@type": "Answer", "text": "La programmation hebdomadaire est sur la page Horaire 2026 et en un clic Ajouter à mon agenda (.ics)." },
          },
          {
            "@type": "Question",
            "name": "Comment réécouter un mix ou un podcast ?",
            "acceptedAnswer": { "@type": "Answer", "text": "Tous les DJ sets et émissions sont sur la page Podcasts & Mixes, filtrables et partageables." },
          },
        ],
      },
    ],
  };
  const s = document.createElement("script");
  s.type = "application/ld+json";
  s.id = "hr-jsonld";
  s.textContent = JSON.stringify(data);
  document.head.appendChild(s);
}
