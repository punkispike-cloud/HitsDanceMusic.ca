/* Base URL de l'API backend (Railway). Vient de la config de marque
   (généré par build-brand), surchargeable via <meta name="hr-api-url"> si besoin. */

import { BRAND } from "./brand.generated.js";

const META = document.querySelector('meta[name="hr-api-url"]')?.content?.trim();

export const API_BASE = META || BRAND.urls.api;
