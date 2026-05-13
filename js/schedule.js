/* Grille hebdo 2026 + slot helpers + génération table + export .ics. */

import { $, $$, escapeHtml } from "./util.js";
import { toast } from "./toast.js";
import { getMontrealParts, toMinutes, DAY_NAMES } from "./time.js";
import { state } from "./state.js";

export const SLOT_TAGS = {
  morning:   { color: "#e8b84b", label: "Morning" },
  hitlist:   { color: "#c8102e", label: "Hit List" },
  drive:     { color: "#e07020", label: "Drive" },
  limelight: { color: "#7c44a8", label: "Limelight" },
  night:     { color: "#1a3055", label: "Nuits BeatRadioWorld" },
  special:   { color: "#2a7a6a", label: "Spécial" },
  audition:  { color: "#666",    label: "Audition" },
};

export const SCHEDULE = {
  0: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Hit List","Programmation","hitlist"],
    ["09:00","11:00","Disco Fever Experience","Programmation","special"],
    ["11:00","14:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["14:00","15:00","JÜMPOFFproject","DJ JÜMPOFF","drive"],
    ["15:00","17:00","Hits Dance Top 40 (reprise)","Programmation","hitlist"],
    ["17:00","19:00","Animateur en audition","Audition","audition"],
    ["19:00","20:00","Pee Jee Radio Show","Pee Jee","special"],
    ["20:00","21:00","Latino Show","DJ Isael Soccaras","special"],
    ["21:00","22:00","Franco chaud","Programmation","special"],
    ["22:00","24:00","Hot Slow Show","Programmation","limelight"],
  ],
  1: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","11:00","Hit List","Programmation","hitlist"],
    ["11:00","12:00","Latino Show","DJ Isael Soccaras","special"],
    ["12:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","22:00","Hit List","Programmation","hitlist"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  2: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","22:00","Hit List","Programmation","hitlist"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  3: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","12:00","Hit List","Programmation","hitlist"],
    ["12:00","14:00","Disco Fever Experience","Programmation","special"],
    ["14:00","16:00","Hit List (live)","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive","Alain Perron","drive"],
    ["18:00","21:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["21:00","22:00","JÜMPOFFproject","DJ JÜMPOFF","drive"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  4: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","12:00","Hit List","Programmation","hitlist"],
    ["12:00","13:00","JÜMPOFFproject","DJ JÜMPOFF","drive"],
    ["13:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","21:00","Hit List","Programmation","hitlist"],
    ["21:00","22:00","DJ OSKANA","DJ OSKANA","special"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  5: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Les matins d'Alain (live)","Alain Perron","morning"],
    ["09:00","16:00","Hit List","Programmation","hitlist"],
    ["16:00","18:00","Le Hit Drive (live)","Alain Perron","drive"],
    ["18:00","19:00","JÜMPOFFproject","DJ JÜMPOFF","drive"],
    ["19:00","22:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
  6: [
    ["00:00","07:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
    ["07:00","09:00","Hit List","Programmation","hitlist"],
    ["09:00","10:00","Latino Show","DJ Isael Soccaras","special"],
    ["10:00","12:00","Animateur en audition","Audition","audition"],
    ["12:00","14:00","Hits Dance Top 40","Programmation","hitlist"],
    ["14:00","17:00","Hit List","Programmation","hitlist"],
    ["17:00","18:00","JÜMPOFFproject","DJ JÜMPOFF","drive"],
    ["18:00","21:00","Hommage au Limelight Montréal","DJ Pierre Jutras","limelight"],
    ["21:00","22:00","DJ OSKANA Show mix européen","DJ OSKANA","special"],
    ["22:00","24:00","Les nuits Best DJ's live internationaux BeatRadioWorld","BeatRadioWorld","night"],
  ],
};

export function getCurrentSlot(date = new Date()) {
  const { day, hour, minute } = getMontrealParts(date);
  const nowMin = hour * 60 + minute;
  for (const [from, to, title, host, tag] of (SCHEDULE[day] || [])) {
    const fromMin = toMinutes(from);
    const toMin = to === "24:00" ? 24 * 60 : toMinutes(to);
    if (nowMin >= fromMin && nowMin < toMin) {
      return { from, to: to === "24:00" ? "00:00" : to, title, host, tag, day };
    }
  }
  return { from: "00:00", to: "07:00", title: "Hits Dance Music en continu", host: "Programmation", tag: "hitlist", day };
}

export function getNextSlot(date = new Date()) {
  const { day, hour, minute } = getMontrealParts(date);
  const nowMin = hour * 60 + minute;
  const slots = SCHEDULE[day] || [];
  for (const [from, to, title, host, tag] of slots) {
    const fromMin = toMinutes(from);
    if (fromMin > nowMin) {
      return { from, to, title, host, tag, sameDay: true, day };
    }
  }
  const nextDay = (day + 1) % 7;
  const nextSlots = SCHEDULE[nextDay] || [];
  if (nextSlots.length) {
    const [from, to, title, host, tag] = nextSlots[0];
    return { from, to, title, host, tag, sameDay: false, day: nextDay };
  }
  return null;
}

export function findNextSlotForHost(hostName) {
  const norm = (s) => (s || "").toLowerCase();
  const target = norm(hostName);
  const { day, hour, minute } = getMontrealParts();
  const nowMin = hour * 60 + minute;
  for (let off = 0; off < 7; off++) {
    const d = (day + off) % 7;
    const slots = SCHEDULE[d] || [];
    for (const [from, to, title, host, tag] of slots) {
      if (!norm(host).includes(target.split(" ")[0]) && !norm(title).includes(target.split(" ")[0])) continue;
      const fromMin = toMinutes(from);
      if (off > 0 || fromMin > nowMin) {
        return { from, to, title, host, tag, day: d };
      }
    }
  }
  return null;
}

export function buildScheduleTable() {
  const host = $("#scheduleFull");
  if (!host) return;
  const today = getMontrealParts().day;
  const order = [1,2,3,4,5,6,0];
  host.innerHTML = order.map((d) => {
    const slots = SCHEDULE[d] || [];
    const isToday = d === today;
    return `<details class="day-block${isToday ? " is-today" : ""}"${isToday ? " open" : ""}>
      <summary>${DAY_NAMES[d]}${isToday ? " · aujourd'hui" : ""}</summary>
      <ul class="slot-list">
        ${slots.map(([from, to, title, host, tag]) => `
          <li class="slot--${tag}">
            <span class="slot-time">${from}–${to === "24:00" ? "00:00" : to}</span>
            <span class="slot-title">${escapeHtml(title)}</span>
            <span class="slot-host">${escapeHtml(host)}</span>
          </li>`).join("")}
      </ul>
    </details>`;
  }).join("");
}

export function downloadIcs() {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hits Dance Music//Schedule//FR", "CALSCALE:GREGORIAN",
  ];
  const order = [1,2,3,4,5,6,0];
  const today = new Date();
  const dow = today.getDay();
  const offsetToMonday = (dow === 0 ? 1 : (8 - dow) % 7 || 7);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (offsetToMonday === 7 ? 0 : offsetToMonday));
  function fmt(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  }
  order.forEach((dayKey, dayIdx) => {
    const base = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIdx);
    for (const [from, to, title, host] of (SCHEDULE[dayKey] || [])) {
      const [fh, fm] = from.split(":").map(Number);
      const [th, tm] = (to === "24:00" ? "24:00" : to).split(":").map(Number);
      const start = new Date(base); start.setHours(fh, fm, 0, 0);
      const end = new Date(base);
      if (th === 24) { end.setDate(end.getDate() + 1); end.setHours(0, tm, 0, 0); }
      else end.setHours(th, tm, 0, 0);
      lines.push("BEGIN:VEVENT",
        `UID:${start.getTime()}-${dayKey}-hitradio@local`,
        `DTSTART;TZID=America/Toronto:${fmt(start)}`,
        `DTEND;TZID=America/Toronto:${fmt(end)}`,
        `SUMMARY:${title.replace(/[\r\n,;]/g, " ")}`,
        `DESCRIPTION:${(host || "").replace(/[\r\n,;]/g, " ")} — Hits Dance Music`,
        "RRULE:FREQ=WEEKLY",
        "END:VEVENT");
    }
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hit-radio-grille-2026.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Fichier .ics téléchargé — importe-le dans ton agenda.", "ok");
}

export function highlightCurrentSlot() {
  const blocks = $$(".day-block");
  if (!blocks.length || !state.currentSlot) return;
  const domIndexForDay = { 1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 0:6 };
  const todayBlockIdx = domIndexForDay[state.currentSlot.day];
  blocks.forEach((b, i) => {
    const isToday = i === todayBlockIdx;
    b.classList.toggle("is-today", isToday);
    if (isToday && !b.dataset.userToggled) b.open = true;
    b.addEventListener("toggle", () => { b.dataset.userToggled = "1"; }, { once: true });
  });
  const todayBlock = blocks[todayBlockIdx];
  if (!todayBlock) return;
  $$("li", todayBlock).forEach((li) => li.classList.remove("is-now"));
  const items = $$(".slot-list li", todayBlock);
  for (const li of items) {
    const time = $(".slot-time", li)?.textContent?.trim() || "";
    if (time.startsWith(state.currentSlot.from)) {
      li.classList.add("is-now");
      if (!$(".now-badge", li)) {
        const b = document.createElement("span");
        b.className = "now-badge";
        b.innerHTML = `<span class="now-dot" aria-hidden="true"></span>ON AIR`;
        li.appendChild(b);
      }
      break;
    }
  }
}
