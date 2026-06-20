/* Seed de DÉPART pour la radio « Rockfort » (rock vintage / Fender old-school).
   Sert à booter la DB d'un nouveau client avec SA grille / SES animateurs /
   SES émissions — l'équipe ajuste ensuite tout depuis l'admin (CRUD complet).
   Aucune donnée n'est partagée avec Hits Dance Music : face ET contenu propres.

   Les TAGS réutilisent les clés de l'enum DB (morning/hitlist/drive/limelight/
   night/special/audition) — le frontend Rockfort leur donne ses propres
   libellés/couleurs (Réveil, Rotation Rock, Légendes, Nuit Métal…). */

import type { SeedArtist, SeedShow, ScheduleRow } from "./seed-data.js";

export const ROCKRADIO_ARTISTS: SeedArtist[] = [
  {
    slug: "lou-sauvage",
    name: "Lou Sauvage",
    photoUrl: null,
    initials: "LS",
    showTitle: "Réveil Distorsion (live)",
    scheduleText: "Lun–Ven · 07h00–10h00",
    bio: "Réveille la province à coups de classiques et de gros riffs, en direct chaque matin.",
    sortOrder: 1,
  },
  {
    slug: "le-vieux-loup",
    name: "Le Vieux Loup",
    photoUrl: null,
    initials: "VL",
    showTitle: "Légendes du Riff · Vinyle & Whisky",
    scheduleText: "Soirs & nuits · week-end",
    bio: "Gardien des deep cuts et des faces B oubliées. Vinyles, anecdotes et whisky.",
    sortOrder: 2,
  },
  {
    slug: "la-sorciere-du-riff",
    name: "La Sorcière du Riff",
    photoUrl: null,
    initials: "SR",
    showTitle: "Heavy Hour",
    scheduleText: "Tous les soirs · 22h00",
    bio: "Métal, hard et stoner pour finir la soirée à plein régime. Volume non négociable.",
    sortOrder: 3,
  },
  {
    slug: "marco-fuzz",
    name: "Marco Fuzz",
    photoUrl: null,
    initials: "MF",
    showTitle: "Le Drive Électrique (live)",
    scheduleText: "Lun–Ven · 16h00–18h00",
    bio: "Le retour à la maison en mode amplis à fond. Sorties chaudes et demandes d'auditeurs.",
    sortOrder: 4,
  },
  {
    slug: "dani-distorsion",
    name: "Dani Distorsion",
    photoUrl: null,
    initials: "DD",
    showTitle: "Garage QC · indé d'ici",
    scheduleText: "Sam. · 10h00",
    bio: "Chasseuse de groupes émergents : garage, punk et indé du Québec et d'ailleurs.",
    sortOrder: 5,
  },
  {
    slug: "steve-granite",
    name: "Steve Granite",
    photoUrl: null,
    initials: "SG",
    showTitle: "Café Granite",
    scheduleText: "Sam. & dim. · 07h00–10h00",
    bio: "Le rock du week-end en douceur : café noir, acoustiques et grands classiques.",
    sortOrder: 6,
  },
  {
    slug: "iggy-tremblay",
    name: "Iggy Tremblay",
    photoUrl: null,
    initials: "IT",
    showTitle: "Live Sessions",
    scheduleText: "Jeu. 21h · Sam. 20h",
    bio: "Sessions live captées en studio : groupes invités, reprises et premières.",
    sortOrder: 7,
  },
];

export const ROCKRADIO_SHOWS: SeedShow[] = [
  { title: "Réveil Distorsion", badge: "Matin · Live", tag: "morning", description: "Le réveil rock en direct : classiques, nouveautés et gros riffs pour partir la journée.", artistSlug: "lou-sauvage", scheduleText: "Lun–Ven · 07h00–10h00", sortOrder: 1 },
  { title: "Rotation Rock", badge: "Antenne", tag: "hitlist", description: "La colonne musicale de Rockfort : classic rock, hard et indé en rotation tout le jour.", artistSlug: null, scheduleText: "Tous les jours, plusieurs créneaux", sortOrder: 2 },
  { title: "Le Drive Électrique", badge: "Drive · Live", tag: "drive", description: "Le retour maison à plein volume. Sorties chaudes, demandes et amplis poussés à fond.", artistSlug: "marco-fuzz", scheduleText: "Lun–Jeu · 16h00–18h00", sortOrder: 3 },
  { title: "Les Riffs du Vendredi", badge: "Vendredi · Live", tag: "drive", description: "On lance le week-end avec les plus gros riffs de la semaine, en direct.", artistSlug: "marco-fuzz", scheduleText: "Ven. · 16h00–18h00", sortOrder: 4 },
  { title: "Légendes du Riff", badge: "Légendes", tag: "limelight", description: "Une heure dédiée aux monuments du rock et à leurs faces cachées, par Le Vieux Loup.", artistSlug: "le-vieux-loup", scheduleText: "Mar. & ven. · soir", sortOrder: 5 },
  { title: "Vinyle & Whisky", badge: "Vinyle", tag: "limelight", description: "Sélection 100 % vinyle : deep cuts, raretés et anecdotes au coin du feu.", artistSlug: "le-vieux-loup", scheduleText: "Dim. 10h · sam. 17h", sortOrder: 6 },
  { title: "Heavy Hour", badge: "Soirée", tag: "night", description: "Métal, hard et stoner pour finir la soirée à plein régime. Casques recommandés.", artistSlug: "la-sorciere-du-riff", scheduleText: "Tous les soirs · 22h00", sortOrder: 7 },
  { title: "Garage QC", badge: "Indé", tag: "special", description: "Le garage, le punk et l'indé d'ici. Groupes émergents et scène locale.", artistSlug: "dani-distorsion", scheduleText: "Mer. & sam.", sortOrder: 8 },
  { title: "Indé d'ici", badge: "Découverte", tag: "special", description: "Coup de projecteur sur les artistes rock émergents du Québec.", artistSlug: "dani-distorsion", scheduleText: "Lun. · 21h00", sortOrder: 9 },
  { title: "Power Ballades", badge: "Spécial", tag: "special", description: "Les grandes ballades rock pour clore le dimanche, briquet en l'air.", artistSlug: "lou-sauvage", scheduleText: "Dim. · 20h00", sortOrder: 10 },
  { title: "Café Granite", badge: "Week-end", tag: "morning", description: "Le rock du week-end en douceur : acoustiques, café noir et classiques.", artistSlug: "steve-granite", scheduleText: "Sam. & dim. · 07h00–10h00", sortOrder: 11 },
  { title: "Autoroute 666", badge: "Nuit", tag: "night", description: "Le bloc nuit de Rockfort : enchaînement rock sans fin, de minuit au petit matin.", artistSlug: "le-vieux-loup", scheduleText: "Toutes les nuits · 00h00–07h00", sortOrder: 12 },
  { title: "Iggy Tremblay — Live Sessions", badge: "Live", tag: "special", description: "Sessions live captées en studio : groupes invités, reprises et premières.", artistSlug: "iggy-tremblay", scheduleText: "Jeu. 21h · sam. 20h", sortOrder: 13 },
];

// Copie de la grille Rockfort (frontend client/rockradio : js/schedule.js).
// 0 = dimanche .. 6 = samedi. Sert de seed initial — éditable via l'admin.
export const ROCKRADIO_SCHEDULE: Record<number, ScheduleRow[]> = {
  0: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Café Granite", "Steve Granite", "morning"],
    ["10:00", "13:00", "Vinyle & Whisky", "Le Vieux Loup", "limelight"],
    ["13:00", "17:00", "Rotation Rock", "Programmation", "hitlist"],
    ["17:00", "20:00", "Garage QC", "Dani Distorsion", "special"],
    ["20:00", "22:00", "Power Ballades", "Lou Sauvage", "special"],
    ["22:00", "24:00", "Heavy Hour", "La Sorcière du Riff", "night"],
  ],
  1: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Réveil Distorsion (live)", "Lou Sauvage", "morning"],
    ["10:00", "16:00", "Rotation Rock", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Drive Électrique (live)", "Marco Fuzz", "drive"],
    ["18:00", "21:00", "Rotation Rock", "Programmation", "hitlist"],
    ["21:00", "22:00", "Indé d'ici", "Dani Distorsion", "special"],
    ["22:00", "24:00", "Autoroute 666", "Le Vieux Loup", "night"],
  ],
  2: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Réveil Distorsion (live)", "Lou Sauvage", "morning"],
    ["10:00", "16:00", "Rotation Rock", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Drive Électrique (live)", "Marco Fuzz", "drive"],
    ["18:00", "22:00", "Légendes du Riff", "Le Vieux Loup", "limelight"],
    ["22:00", "24:00", "Autoroute 666", "Le Vieux Loup", "night"],
  ],
  3: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Réveil Distorsion (live)", "Lou Sauvage", "morning"],
    ["10:00", "16:00", "Rotation Rock", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Drive Électrique (live)", "Marco Fuzz", "drive"],
    ["18:00", "21:00", "Heavy Hour", "La Sorcière du Riff", "night"],
    ["21:00", "22:00", "Garage QC", "Dani Distorsion", "special"],
    ["22:00", "24:00", "Autoroute 666", "Le Vieux Loup", "night"],
  ],
  4: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Réveil Distorsion (live)", "Lou Sauvage", "morning"],
    ["10:00", "16:00", "Rotation Rock", "Programmation", "hitlist"],
    ["16:00", "18:00", "Le Drive Électrique (live)", "Marco Fuzz", "drive"],
    ["18:00", "21:00", "Rotation Rock", "Programmation", "hitlist"],
    ["21:00", "22:00", "Iggy Tremblay — Live Sessions", "Iggy Tremblay", "special"],
    ["22:00", "24:00", "Autoroute 666", "Le Vieux Loup", "night"],
  ],
  5: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Réveil Distorsion (live)", "Lou Sauvage", "morning"],
    ["10:00", "16:00", "Rotation Rock", "Programmation", "hitlist"],
    ["16:00", "18:00", "Les Riffs du Vendredi (live)", "Marco Fuzz", "drive"],
    ["18:00", "21:00", "Légendes du Riff", "Le Vieux Loup", "limelight"],
    ["21:00", "24:00", "Heavy Hour", "La Sorcière du Riff", "night"],
  ],
  6: [
    ["00:00", "07:00", "Autoroute 666", "Le Vieux Loup", "night"],
    ["07:00", "10:00", "Café Granite", "Steve Granite", "morning"],
    ["10:00", "13:00", "Garage QC", "Dani Distorsion", "special"],
    ["13:00", "17:00", "Rotation Rock", "Programmation", "hitlist"],
    ["17:00", "20:00", "Vinyle & Whisky", "Le Vieux Loup", "limelight"],
    ["20:00", "22:00", "Iggy Tremblay — Live Sessions", "Iggy Tremblay", "special"],
    ["22:00", "24:00", "Heavy Hour", "La Sorcière du Riff", "night"],
  ],
};

export const ROCKRADIO_HOST_TO_ARTIST_SLUG: Record<string, string | null> = {
  "Lou Sauvage": "lou-sauvage",
  "Le Vieux Loup": "le-vieux-loup",
  "La Sorcière du Riff": "la-sorciere-du-riff",
  "Marco Fuzz": "marco-fuzz",
  "Dani Distorsion": "dani-distorsion",
  "Steve Granite": "steve-granite",
  "Iggy Tremblay": "iggy-tremblay",
  Programmation: null,
};
