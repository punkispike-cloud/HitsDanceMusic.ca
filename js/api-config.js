/* Base URL de l'API backend (Railway). Hardcodée comme STREAM_URL/PANEL_URL,
   surchargeable via <meta name="hr-api-url" content="https://..."> si besoin. */

const META = document.querySelector('meta[name="hr-api-url"]')?.content?.trim();

export const API_BASE = META || "https://patient-endurance-production-21c8.up.railway.app";
