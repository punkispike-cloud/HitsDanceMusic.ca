/* Base URL de l'API backend (Railway). Vient de la config de marque
   (généré par build-brand), surchargeable via <meta name="hr-api-url"> si besoin.
   Le guard `typeof document` permet au module d'être importé hors navigateur
   (tests Node : schedule/now-playing) sans lever de ReferenceError. */

import { BRAND } from "./brand.generated.js";

const META = typeof document !== "undefined"
  ? document.querySelector('meta[name="hr-api-url"]')?.content?.trim()
  : undefined;

export const API_BASE = META || BRAND.urls.api;
