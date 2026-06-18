/* Données de seed extraites des fichiers front existants (source de vérité
   actuelle). AUCUN fichier front n'est modifié — on recopie ici la donnée
   pour la migrer en DB. À garder synchronisé tant que le front est gelé. */

import type { SlotTag } from "./schema.js";

export interface SeedArtist {
  slug: string;
  name: string;
  photoUrl: string | null;
  initials: string | null;
  showTitle: string | null;
  scheduleText: string | null;
  bio: string | null;
  sortOrder: number;
}

// Depuis animateurs.html (lignes 98-146)
export const SEED_ARTISTS: SeedArtist[] = [
  {
    slug: "alain-perron",
    name: "Alain Perron",
    photoUrl: "assets/alain-perron.webp",
    initials: "AP",
    showTitle: "Les matins d'Alain (live)",
    scheduleText: "Lun–Ven · 07h00–09h00",
    bio: "Réveil dance & house, lien direct avec les auditeurs en semaine.",
    sortOrder: 1,
  },
  {
    slug: "pierre-jutras",
    name: "DJ Pierre Jutras",
    photoUrl: "assets/pierre-jutras.webp",
    initials: "PJ",
    showTitle: "Hommage au Limelight Montréal",
    scheduleText: "Mer., ven., sam., dim.",
    bio: "Sets hommage au club légendaire — plusieurs créneaux dans la grille.",
    sortOrder: 2,
  },
  {
    slug: "jumpoff",
    name: "DJ JÜMPOFF",
    photoUrl: "assets/jumpoff.webp",
    initials: "JO",
    showTitle: "JÜMPOFFproject — mix club & live",
    scheduleText: "Mer., jeu., ven., sam., dim.",
    bio: "Transitions club, soirées et blocs énergie dance.",
    sortOrder: 3,
  },
  {
    slug: "oskana",
    name: "DJ OSKANA",
    photoUrl: "assets/dj-red-headphones.webp",
    initials: "OK",
    showTitle: "Show mix européen",
    scheduleText: "Jeu. 21h · Sam. 21h",
    bio: "Sélection house & dance orientée Europe.",
    sortOrder: 4,
  },
  {
    slug: "isael-soccaras",
    name: "DJ Isael Soccaras",
    photoUrl: "assets/isael-soccaras.webp",
    initials: "IS",
    showTitle: "DJ invité — sets dance & club",
    scheduleText: "Créneaux à venir",
    bio: "Nouvelle signature DJ de la programmation 2026.",
    sortOrder: 5,
  },
  {
    slug: "pee-jee",
    name: "Pee Jee",
    photoUrl: null,
    initials: "Pg",
    showTitle: "Pee Jee Radio Show",
    scheduleText: "Dim. 19h00–20h00",
    bio: "Format dédié le dimanche soir.",
    sortOrder: 6,
  },
  {
    slug: "best-djs-international",
    name: "Best DJ's international",
    photoUrl: null,
    initials: "BR",
    showTitle: "Nuits BeatRadioWorld",
    scheduleText: "22h00–07h00 · selon journée",
    bio: "Bloc nuit international — enchaînement après les journées et le Hot Slow (dim.).",
    sortOrder: 7,
  },
];

export interface SeedShow {
  title: string;
  badge: string;
  tag: SlotTag | null;
  description: string;
  artistSlug: string | null;
  scheduleText: string;
  sortOrder: number;
}

// Depuis emissions.html (lignes 98-181)
export const SEED_SHOWS: SeedShow[] = [
  { title: "Les matins d'Alain", badge: "Matin · Live", tag: "morning", description: "Réveil dance & house, lien direct avec les auditeurs en semaine. Toujours en direct du studio.", artistSlug: "alain-perron", scheduleText: "Lun–Ven · 07h00–09h00", sortOrder: 1 },
  { title: "Hit List", badge: "Playlist", tag: "hitlist", description: "La colonne musicale du jour : hits dance, club et top 40 en rotation tout au long de la grille.", artistSlug: null, scheduleText: "Tous les jours, plusieurs créneaux", sortOrder: 2 },
  { title: "Le Hit Drive", badge: "Drive · Live", tag: "drive", description: "Retour maison en mode dance. Plusieurs créneaux « live » dans la semaine pour ponctuer la fin d'après-midi.", artistSlug: "alain-perron", scheduleText: "Lun–Ven · 16h00–18h00", sortOrder: 3 },
  { title: "Hommage au Limelight Montréal", badge: "Hommage", tag: "limelight", description: "Sets hommage au club légendaire montréalais. Disco, house classique, ambiance club d'époque.", artistSlug: "pierre-jutras", scheduleText: "Mer., ven., sam., dim.", sortOrder: 4 },
  { title: "Nuits Best DJ's BeatRadioWorld", badge: "Nuit", tag: "night", description: "Bloc nuit international — meilleurs DJs en continu. Prolongation 22h00 → 07h00.", artistSlug: "best-djs-international", scheduleText: "Toutes les nuits", sortOrder: 5 },
  { title: "JÜMPOFFproject", badge: "Mix club", tag: "drive", description: "Transitions club, soirées et blocs énergie dance signés JÜMPOFFproject. Présent plusieurs fois par semaine.", artistSlug: "jumpoff", scheduleText: "Mer., jeu., ven., sam., dim.", sortOrder: 6 },
  { title: "DJ OSKANA Show mix européen", badge: "Europe", tag: "special", description: "Sélection house & dance orientée Europe — sons frais et imports.", artistSlug: "oskana", scheduleText: "Jeu. 21h · Sam. 21h", sortOrder: 7 },
  { title: "Disco Fever Experience", badge: "Spécial", tag: "special", description: "Plongée disco — classiques et redécouvertes pour mercredi midi et dimanche matin.", artistSlug: null, scheduleText: "Mer. 12h–14h · Dim. 09h–11h", sortOrder: 8 },
  { title: "Latino Show", badge: "Latin", tag: "special", description: "Ambiance latine — reggaeton, salsa, latin house. Trois créneaux par semaine.", artistSlug: "isael-soccaras", scheduleText: "Lun. 11h · Sam. 09h · Dim. 20h", sortOrder: 9 },
  { title: "Animateur en audition", badge: "Découverte", tag: "audition", description: "Créneau ouvert aux animateurs en audition. Contacte le studio pour proposer ton format.", artistSlug: null, scheduleText: "Sam. 10h–12h · Dim. 17h–19h", sortOrder: 10 },
  { title: "Pee Jee Radio Show", badge: "Dimanche", tag: "special", description: "Format dédié le dimanche soir, par Pee Jee.", artistSlug: "pee-jee", scheduleText: "Dim. 19h00–20h00", sortOrder: 11 },
  { title: "Hot Slow Show", badge: "Soirée", tag: "limelight", description: "Slows et titres romantiques pour terminer le dimanche en douceur.", artistSlug: null, scheduleText: "Dim. 22h00–00h00", sortOrder: 12 },
];

export type ScheduleRow = [string, string, string, string, SlotTag];

// Copie VERBATIM de SCHEDULE (js/schedule.js:18-93). 0=dimanche .. 6=samedi.
export const SCHEDULE: Record<number, ScheduleRow[]> = {
  0: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Hit List", "Programmation", "hitlist"],
    ["09:00", "11:00", "Disco Fever Experience", "Programmation", "special"],
    ["11:00", "14:00", "Hommage au Limelight Montréal", "DJ Pierre Jutras", "limelight"],
    ["14:00", "15:00", "JÜMPOFFproject", "DJ JÜMPOFF", "drive"],
    ["15:00", "17:00", "Hits Dance Top 40 (reprise)", "Programmation", "hitlist"],
    ["17:00", "19:00", "Animateur en audition", "Audition", "audition"],
    ["19:00", "20:00", "Pee Jee Radio Show", "Pee Jee", "special"],
    ["20:00", "21:00", "Latino Show", "DJ Isael Soccaras", "special"],
    ["21:00", "22:00", "Franco chaud", "Programmation", "special"],
    ["22:00", "24:00", "Hot Slow Show", "Programmation", "limelight"],
  ],
  1: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Les matins d'Alain (live)", "Alain Perron", "morning"],
    ["09:00", "11:00", "Hit List", "Programmation", "hitlist"],
    ["11:00", "12:00", "Latino Show", "DJ Isael Soccaras", "special"],
    ["12:00", "16:00", "Hit List", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Hit Drive (live)", "Alain Perron", "drive"],
    ["18:00", "22:00", "Hit List", "Programmation", "hitlist"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
  2: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Les matins d'Alain (live)", "Alain Perron", "morning"],
    ["09:00", "16:00", "Hit List", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Hit Drive (live)", "Alain Perron", "drive"],
    ["18:00", "22:00", "Hit List", "Programmation", "hitlist"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
  3: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Les matins d'Alain (live)", "Alain Perron", "morning"],
    ["09:00", "12:00", "Hit List", "Programmation", "hitlist"],
    ["12:00", "14:00", "Disco Fever Experience", "Programmation", "special"],
    ["14:00", "16:00", "Hit List (live)", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Hit Drive", "Alain Perron", "drive"],
    ["18:00", "21:00", "Hommage au Limelight Montréal", "DJ Pierre Jutras", "limelight"],
    ["21:00", "22:00", "JÜMPOFFproject", "DJ JÜMPOFF", "drive"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
  4: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Les matins d'Alain (live)", "Alain Perron", "morning"],
    ["09:00", "12:00", "Hit List", "Programmation", "hitlist"],
    ["12:00", "13:00", "JÜMPOFFproject", "DJ JÜMPOFF", "drive"],
    ["13:00", "16:00", "Hit List", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Hit Drive (live)", "Alain Perron", "drive"],
    ["18:00", "21:00", "Hit List", "Programmation", "hitlist"],
    ["21:00", "22:00", "DJ OSKANA", "DJ OSKANA", "special"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
  5: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Les matins d'Alain (live)", "Alain Perron", "morning"],
    ["09:00", "16:00", "Hit List", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Hit Drive (live)", "Alain Perron", "drive"],
    ["18:00", "19:00", "JÜMPOFFproject", "DJ JÜMPOFF", "drive"],
    ["19:00", "22:00", "Hommage au Limelight Montréal", "DJ Pierre Jutras", "limelight"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
  6: [
    ["00:00", "07:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
    ["07:00", "09:00", "Hit List", "Programmation", "hitlist"],
    ["09:00", "10:00", "Latino Show", "DJ Isael Soccaras", "special"],
    ["10:00", "12:00", "Animateur en audition", "Audition", "audition"],
    ["12:00", "14:00", "Hits Dance Top 40", "Programmation", "hitlist"],
    ["14:00", "17:00", "Hit List", "Programmation", "hitlist"],
    ["17:00", "18:00", "JÜMPOFFproject", "DJ JÜMPOFF", "drive"],
    ["18:00", "21:00", "Hommage au Limelight Montréal", "DJ Pierre Jutras", "limelight"],
    ["21:00", "22:00", "DJ OSKANA Show mix européen", "DJ OSKANA", "special"],
    ["22:00", "24:00", "Les nuits Best DJ's live internationaux BeatRadioWorld", "BeatRadioWorld", "night"],
  ],
};

// Mappe le libellé d'hôte de SCHEDULE vers un slug d'artiste (null si générique).
export const HOST_TO_ARTIST_SLUG: Record<string, string | null> = {
  "Alain Perron": "alain-perron",
  "DJ Pierre Jutras": "pierre-jutras",
  "DJ JÜMPOFF": "jumpoff",
  "DJ OSKANA": "oskana",
  "DJ Isael Soccaras": "isael-soccaras",
  "Pee Jee": "pee-jee",
  BeatRadioWorld: "best-djs-international",
  Programmation: null,
  Audition: null,
};
