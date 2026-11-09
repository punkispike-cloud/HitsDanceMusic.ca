/* Météo Montréal (ou géolocation utilisateur) via Open-Meteo, sans clé. */

import { $, escapeHtml, fetchWithTimeout, NET_TIMEOUTS } from "./util.js";
import { store } from "./store.js";
import { icon } from "./icons.js";

const WEATHER_CODES = {
  0: ["sun", "Ciel clair"], 1: ["cloudSun", "Peu nuageux"], 2: ["cloudSun", "Partiellement nuageux"], 3: ["cloud", "Couvert"],
  45: ["cloudFog", "Brouillard"], 48: ["cloudFog", "Brouillard givrant"],
  51: ["cloudDrizzle", "Bruine légère"], 53: ["cloudDrizzle", "Bruine"], 55: ["cloudRain", "Bruine forte"],
  61: ["cloudRain", "Pluie faible"], 63: ["cloudRain", "Pluie"], 65: ["cloudRain", "Pluie forte"],
  71: ["cloudSnow", "Neige faible"], 73: ["cloudSnow", "Neige"], 75: ["cloudSnow", "Neige forte"],
  80: ["cloudDrizzle", "Averses"], 81: ["cloudRain", "Averses"], 82: ["cloudLightning", "Averses violentes"],
  95: ["cloudLightning", "Orage"], 96: ["cloudLightning", "Orage grêle"], 99: ["cloudLightning", "Orage violent"],
};
const WEATHER_DEFAULT = { lat: 46.8139, lon: -71.2080, name: "Québec" };

function getCachedGeo() {
  const raw = store.getJSON("hr.weather.geo", null);
  if (!raw || typeof raw !== "object") return null;
  if (Date.now() - (raw.ts || 0) > 24 * 60 * 60_000) return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return null;
  return raw;
}
function setCachedGeo(geo) {
  store.setJSON("hr.weather.geo", { ...geo, ts: Date.now() });
}

function getUserPosition() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator) || !window.isSecureContext) return resolve(null);
    const ask = () => navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30 * 60_000 },
    );
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" }).then((p) => {
        if (p.state === "denied") resolve(null);
        else ask();
      }).catch(ask);
    } else ask();
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=fr&count=1`;
    const res = await fetchWithTimeout(url, { cache: "force-cache" }, NET_TIMEOUTS.weather);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.results?.[0];
    return r?.name || null;
  } catch { return null; }
}

export async function loadWeather() {
  const host = $("#mtlWeather");
  if (!host) return;

  let geo = getCachedGeo();
  if (!geo) {
    const pos = await getUserPosition();
    if (pos) {
      const name = await reverseGeocode(pos.lat, pos.lon);
      geo = { lat: pos.lat, lon: pos.lon, name: name || "Ma position" };
      setCachedGeo(geo);
    } else {
      geo = WEATHER_DEFAULT;
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
    const res = await fetchWithTimeout(url, { cache: "no-store" }, NET_TIMEOUTS.weather);
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    const c = data?.current || {};
    const code = Number(c.weather_code);
    const temp = Number(c.temperature_2m);
    if (!Number.isFinite(temp)) throw new Error("weather payload");
    const [iconName, label] = WEATHER_CODES[code] || ["thermometer", "—"];
    host.hidden = false;
    host.title = `Météo ${geo.name} · mise à jour toutes les 10 min`;
    host.innerHTML = `
      <span class="weather-emoji" aria-hidden="true">${icon(iconName)}</span>
      <span class="weather-temp">${Math.round(temp)}°</span>
      <span class="weather-meta"><strong>${escapeHtml(geo.name)}</strong> · ${escapeHtml(label)}</span>`;
  } catch {
    host.hidden = true;
  }
}
