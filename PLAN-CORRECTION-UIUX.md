# Plan de correction UI/UX — En Ondes (toutes surfaces)

> Généré le 2026-06-25 par audit multi-agents (skill `ui-ux-pro-max`, rubric 10 priorités).
> **159 constats audités → 156 retenus** après vérification adversariale (3 rejetés).
> Méthode : 1 passe d'audit par dimension/surface → vérification adversariale (re-lecture du code, rejet des faux positifs) → synthèse par surface → plan global séquencé.
>
> **Périmètre couvert :** `enondes-site/` (hub + landing pro — audité séparément, 50 constats) · site public **Hits Dance** (racine, *frontend gelé*) · **operator/** (CRM, vanilla JS) · **admin/** (back-office Next.js/React/TS).
> **Hors périmètre UI/UX :** `api/`, `presence/` (back-end → relèvent de `/code-review` ou `/security-review`).
> **Lacune connue :** la tâche d'audit « CRUD admin » (grille/émissions/mixes/podcasts/animateurs sous l'angle formulaires) a échoué (StructuredOutput) — couverte partiellement par les autres tâches admin, à relancer si besoin d'un focus formulaires d'édition.

---

## Résumé exécutif

Le projet couvre **4 surfaces dont 3 actionnables** (enondes-site, operator, admin) et **1 gelée** (Hits Dance public).

Constat transverse : **l'accessibilité clavier est bloquante partout** sur les surfaces non gelées (aucun `:focus-visible` dans `operator/console.css` ni dans tout le back-office admin), **le feedback dynamique n'est jamais annoncé** aux lecteurs d'écran (toasts, MAJ auto, statut lecteur, passages UP/DOWN), et **l'état ERREUR/OFFLINE est systématiquement confondu avec le vide** (un opérateur ou un admin prend une panne pour un parc neuf). L'admin est de plus **inutilisable sur tablette/mobile** (zéro media query) alors que la stratégie est PWA-first.

**4 priorités absolues :**
1. Pass **focus clavier** + **cibles tactiles 44px** sur enondes + operator + admin.
2. Pass **aria-live / annonces d'états** sur les 3 surfaces.
3. **Distinction erreur / offline / vide** + bouton *Réessayer* transverse.
4. **Responsive du back-office admin** + **conformités de lancement de la landing pro** (tableau comparatif emoji = échec WCAG A, CTA mailto cassé, Loi 25).

Hits Dance reste **gelé → Phase 5**, **sauf 2 items critiques** dont le dégel est recommandé (modales sans piège de focus sur l'install PWA ; cartes animateurs cliquables-mortes en repli API) — violations WCAG A sur parcours clés, sans risque de cascade. La **dette CSS Hits Dance** (32 `@import`, 78 `!important`, header magic-numbers) reste un lot **L** différé, à traiter après bundler.

---

## Verdicts par surface

| Surface | État | Constats | Verdict |
|---|---|---|---|
| **enondes-site** (hub + pro) | non gelé | 50 | Fonctionnel mais **non prêt au lancement** : tableau comparatif pro en emojis nues (WCAG A), CTA pro = mailto cassé sans calendrier ni preuve, angles morts a11y du hub (états play/favori muets, collision `.controls`, cibles <44px, erreur sans *Réessayer*, reconnexion infinie), tokens divergents hub vs pro. **Porte le lancement commercial.** |
| **operator** | non gelé | 13 | Console sobre et fonctionnelle mais **a11y clavier bloquante** (aucun `:focus`). États incident **dangereux pour un cockpit** : sur échec de fetch les données restent périmées sans signal, 1er chargement raté bloqué sur « Chargement… », rien en aria-live (un opérateur peut croire une radio UP). Polling 30s invisible. |
| **admin** | non gelé | 49 | Back-office riche mais **manques a11y systémiques** : aucun focus visible (`outline:none`), **zéro media query** (inutilisable tablette/mobile), toasts/erreurs muets, labels d'auth non associés (WCAG A), modales sans `dialog`/focus-trap, erreur API déguisée en vide. Majorité des fix **S/M centralisables** (globals.css, Field, Modal, Toast). |
| **hitsdance** | **GELÉ — Phase 5** | 44 | PWA mature mais **dette CSS de patch** (32 `@import` render-blocking, 78 `!important`, header magic-numbers) et angles morts a11y sur les composants dynamiques. Aucun blocage pour l'utilisateur souris/voyant mais **violations WCAG réelles**. Gelé sauf 2 critiques recommandés au dégel. |

---

## Lots séquencés

L'ordre encode les dépendances : les pass transverses a11y (L1, L2) sont le socle qui rend les autres lots testables ; L3 réutilise les régions aria-live de L2 et le focus de L1.

### L1 — Pass accessibilité bloquante : focus clavier visible + cibles 44px `[bloque le lancement]`
**Surfaces :** enondes-site · operator · admin — **Effort :** ~1-2 j (1 passe/surface)
**Pourquoi rang 1 :** opérabilité clavier nulle (operator + admin `outline:none`) = WCAG A/AA violé partout ; touch <44px sur cockpit tactile (régie) et back-office PWA-first. Fix majoritairement **S et centralisés** (une règle `:focus-visible` par feuille, une `@media (pointer:coarse)`). Socle qui débloque le test de tous les autres lots.

- **[operator · critical · S]** Aucun `:focus-visible` dans tout `console.css` → règle `:focus-visible{outline:2px solid var(--accent);offset:2px}` indépendante de `:hover`.
- **[admin · critical · S]** Aucun focus visible (`.field:focus = outline:none`) → `:focus-visible` sur btn/nav/table/field en globals.css ; jamais `outline:none`.
- **[operator · high · S]** Cibles <44px : `.act` et bouton Rafraîchir → `min-height:44px`, `td.actions` en flex gap 8px.
- **[admin · high · S]** `.btn-sm` ~26px → `@media(pointer:coarse){.btn-sm{min-height:44px}}`, actions de ligne en `.row-actions`.
- **[enondes · high · S]** chips/swchips/`.pro-link` <44px + `touch-action:manipulation` + feedback `:active` absents.
- **[enondes · low · S]** FAQ `summary` <44px + chevron ; header pro `safe-area-inset`.

### L2 — Pass annonces lecteurs d'écran : aria-live & rôles `[bloque le lancement]`
**Surfaces :** enondes-site · operator · admin — **Effort :** ~1 j
**Pourquoi rang 2 :** sur operator c'est **dangereux** (un opérateur SR n'est jamais notifié d'un DOWN) ; sur admin le seul canal CRUD (toast) est muet ; sur le hub, états play/favori non annoncés. Fix quasi tous **S**. Suit L1 car ces régions coexistent avec le focus rendu visible.

- **[admin · critical · S]** Toasts sans aria-live (feedback CRUD muet) → `aria-live=polite` ; error/warn → `role=alert`.
- **[admin · high · S]** Erreurs/notices d'auth en `<p>` nus → `role=alert` / `role=status`.
- **[operator · high · S]** Aucune région aria-live → `#lastUpdate role=status`, résumé sr-only « N en ligne, M hors ligne », `caption`/aria-label sur la table (**pas** d'aria-live sur tout le tbody).
- **[operator · medium · S]** Copie de commande : `TypeError` possible, pas de `.catch`/fallback, succès non annoncé.
- **[enondes · high · S]** aria-live barre de lecture + `#pSub` + état bouton play de carte + favori muet.
- **[admin · high · M]** Graphes/SVG sans alternative tabulaire ni résumé SR (`.sr-only` absent) → table sr-only + `VisitorMap role=img`.

### L3 — États erreur / offline / vide distincts + Réessayer `[bloque le lancement]`
**Surfaces :** enondes-site · operator · admin — **Effort :** ~2-3 j (1 passe/surface)
**Pourquoi rang 3 :** **sécurité opérationnelle** — l'opérateur/admin prend une panne pour un parc neuf, peut croire une radio UP. Pattern commun error/null/loading (**M**/surface). Réutilise les régions aria-live (L2) et le focus (L1).

- **[operator · high · M]** Échec fetch : données périmées sans signal + 1er chargement bloqué sur « Chargement… » → état erreur + *Réessayer*, écoute online/offline.
- **[admin · high · M]** ERREUR confondue avec le vide partout (catchs → `[]`/`0`) → pattern `error/null/loading` commun ; dashboard sans 0 fabriqués.
- **[admin · medium · M]** Aucun état OFFLINE → bannière sticky via listeners online/offline.
- **[admin · medium · S]** État vide manquant pour la table des radios (parc vide passe la garde).
- **[admin · medium · S]** Refus d'accès rendu via `<Empty>` (Utilisateurs) → `<Forbidden/>` distinct + libellé de rôle correct.
- **[enondes · high · M]** Erreur chargement stations sans *Réessayer* + reconnexion infinie sans échec définitif.
- **[enondes · medium · M]** Aucun indicateur offline + aucun skeleton au chargement.
- **[enondes · medium · S]** Carte coming Rockfort muette + bouton lecture sans état de chargement.

### L4 — Conformités de lancement de la landing pro `[bloque le lancement]`
**Surfaces :** enondes-site — **Effort :** ~1-2 j
**Pourquoi rang 4 :** la landing **porte le lancement commercial** ; tableau comparatif en emojis nues = WCAG A ; CTA mailto cassé = conversions perdues. Isolé sur pro.html → parallélisable, mais après les pass transverses qui touchent le hub partagé.

- **[enondes · critical · M]** Tableau comparatif pro = emoji nues (échec WCAG A) → texte/SVG + oui/non explicites.
- **[enondes · high · M]** CTA pro = mailto cassé mobile/webmail → formulaire/RDV fiable + preuve + calendrier.
- **[enondes · high · M]** Emojis comme icônes dans pro.html (dont 🇫🇷) → SVG currentColor.
- **[enondes · high · S]** Preuve sociale quasi absente + rappel rareté fondateur près du CTA.
- **[enondes · medium · S]** CTA héro : label ≠ action.
- **[enondes · medium · S]** Footer pro sans politique Loi 25.

### L5 — Responsive back-office admin (PWA-first) + formulaires & modales accessibles `[bloque le lancement]`
**Surfaces :** admin — **Effort :** ~3-4 j
**Pourquoi rang 5 :** zéro media query rend l'admin **inutilisable sur la cible PWA-first** ; labels non associés (WCAG A) ; suspendre sans confirmation **coupe le direct**. Lot **L** cohérent (drawer + Field/Modal partagés), après les pass transverses.

- **[admin · critical · L]** Zéro media query : sidebar 240px figée → reflow + drawer hors-écran (overlay, Escape, fermeture au changement de route).
- **[admin · critical · S]** Labels non associés (auth) → `Field` avec `useId` + `htmlFor`.
- **[admin · high · M]** Modale sans `role=dialog`/focus-trap → `Modal` accessible ; migrer `RadioEditPanel`.
- **[admin · high · M]** Tables sans `overflow-x` ni `scope` ; table du Parc non stylée → `.table-wrap` + `scope=col`.
- **[admin · high · S]** Grille horaire à colonnes fixes : débordement mobile → `@media(max-width:640px)`.
- **[admin · high · M]** Suspendre/Activer sans confirmation ni undo (coupe le direct) → Modal de confirmation.
- **[admin · medium · M]** Validation Parc : erreurs en toast seul → `type=url`/`min`, erreurs par champ (`aria-invalid`/`aria-describedby`), focus 1er fautif.
- **[admin · medium · M]** Pas de focus du 1er champ invalide (auth).
- **[admin · medium · M]** Détail radio : aucune édition (renvoi manuel au Parc) → exporter `RadioEditPanel` + bouton « Éditer ».
- **[admin · medium · S]** Selects de filtre du Journal sans label.
- **[admin · medium · M]** Mots de passe sans bascule de visibilité ni indicateur de force → `PasswordField` réutilisable.
- **[admin · low · S]** Modale `RadioEditPanel` en grille fixe non responsive.

### L6 — Qualité : polling, contrastes, données par couleur seule, emojis-icônes `[non bloquant]`
**Surfaces :** enondes-site · operator · admin — **Effort :** ~2-3 j
**Pourquoi rang 6 :** important mais non bloquant. Regroupé par thème inter-surfaces (contraste, couleur-seule, emoji, reduced-motion) pour traiter d'un geste.

- **[operator · medium · M]** Polling 30s invisible/non pausé, rebuild casse le focus → libellé « Actualisation auto · 30s », pause `visibilitychange`, MAJ ciblée du DOM.
- **[operator · medium · M]** Chargement non annoncé + CLS KPIs → `aria-busy` + squelette à hauteur réservée.
- **[operator · medium · M]** Tableau du parc non triable → en-têtes `aria-sort` + tri (DOWN d'abord).
- **[operator · low · S]** Latence par couleur seule + Rafraîchir sans `aria-busy` + reduced-motion préventif.
- **[operator · medium · M]** Icônes en emojis partout → SVG inline currentColor.
- **[admin · high · S]** Contrastes sous AA (`--txt-faint` etc.) + hex bruts hors tokens.
- **[admin · high · M]** Carte visiteurs + santé du flux (HealthDot) + Journal par couleur seule → légende texte + libellés.
- **[admin · medium · M]** Emojis/glyphes Unicode comme icônes (dont `↻` Journal sans aria-label).
- **[admin · medium · M]** Animations de graphe (SMIL + keyframes) sans `prefers-reduced-motion`.
- **[admin · medium · M]** « Skeleton » réduit à « Chargement… » (CLS) → `TableSkeleton`.
- **[admin · medium · S]** Nav active par `startsWith` sans `aria-current` ; disabled par opacité seule ; détails charts.
- **[enondes · high · S]** genre/now-playing accent rouge <4.5 quand Hits Dance active + footer © contraste.
- **[enondes · high · M]** Cohérence hub : collision `.controls`, scanlines z-index, max-width 1140/1080, debounce recherche, grille ré-animée/perte focus, horloge `innerHTML`/s, emoji 🔜.
- **[enondes · high · M]** Tokens divergents hub.css vs pro.html + couleurs brutes + échelle typo + perfs visuelles (studio-bg → AVIF/WebP, eq/viz en transform, preconnect itunes, backdrop-filter).

### L7 — Dégel ciblé Hits Dance : 2 critiques WCAG A `[non bloquant — exception au gel]`
**Surfaces :** hitsdance — **Effort :** ~0,5 j (2 fix M localisés JS/HTML)
**Pourquoi rang 7 :** frontend gelé, mais ces 2 items sont des **défauts JS/HTML localisés** (pas de la dette CSS) sur des parcours clés, violant WCAG A **sans dépendre de l'ordre des `@import` ni des `!important`** → correction isolée, faible risque de régression. **Dégel recommandé** ; tout le reste de Hits Dance reste différé (L8).

- **[hitsdance · critical · M]** Modales install-pwa + fiche animateur sans piège de focus → helper de modale a11y (mémoriser activeElement, focus fermer, trap/`inert`, restaurer au close, `aria-modal`).
- **[hitsdance · critical · M]** Cartes animateurs cliquables-mortes (clavier + souris) en repli API → `tabindex=0 role=button data-slug aria-label` + `wireTalentCards` indépendant de l'API ; carte sans fiche en `.talent-card--static`.

### L8 — Hits Dance Phase 5 : dette CSS structurelle + a11y/états restants `[différé — frontend gelé]`
**Surfaces :** hitsdance — **Effort :** plusieurs jours (1 L bundler + dette, puis multiples S/M)
**Pourquoi rang 8 :** frontend gelé, aucun blocage souris/voyant. **Séquence interne imposée** : bundler d'abord → tokeniser header/breakpoints → désescalader les `!important` → seulement ensuite les fixes a11y/contraste/états. Audit visuel après chaque retrait.

- **[high · M]** 32 `@import` render-blocking + Google Fonts bloquant → build CSS concat+minify + fonts non-bloquantes.
- **[high · L]** 78 `!important` sur 15 fichiers → cible <10, audit visuel après chaque retrait.
- **[high · M]** Hauteur de header magic-number (110/76/64/60) sur 5+ fichiers → `--header-h` par breakpoint.
- **[high · L]** `.hero` redéfini sur 4 breakpoints / aspect-ratio instable.
- **[high · M]** Liens/textes rouge `#e8192e` sous AA → `--accent-text:#ff5d6c`.
- **[high · S]** États lecteur (buffering/reconnexion/échec) + bannière offline non annoncés → `role=status aria-live`.
- **[high · S]** Cibles <44px : mini-player, mute, fermer modale install.
- **[high · M]** Formulaire contact : validation `reportValidity()` seule → erreurs inline + aria-live.
- **[high · M]** Autocomplete demande de titre non accessible (combobox non conforme).
- **[high · M]** Page Loi 25 incomplète (responsable, coordonnées, date, tiers).
- **[high · M]** Podcasts/mixes : chargement sans skeleton/aria-busy, erreur=vide.
- **[high · M]** Boutons play on-demand : emoji dans textContent, état non transmis.
- **[medium · L]** Dette de cascade restante (drawer mort, `.more-menu`, 3 couches mobile, tokens marque ×3, ticker dupliqué).
- **[medium · M]** Saut h1→h3 emissions, `aria-current` absent, emojis-icônes, horaire ON AIR/.ics, mini-player/MediaSession, contrastes secondaires, focus/keyboard/CLS rails.
- **[medium · L]** Bundle JS non agrégé + features idle chargées au boot → esbuild + `import()` dynamiques.

---

## Différé (frontend gelé Hits Dance)

- **Dette CSS structurelle** (32 `@import`, 78 `!important`, header magic-numbers, `.hero` 4 breakpoints) — chaque retouche exige un audit visuel page par page tant que la cascade n'est pas stabilisée → Phase 5 (L8), après le bundler.
- **Correctifs a11y/états/contrastes localisés** (lecteur, contact, podcasts, autocomplete, Loi 25, horaire, MediaSession, keyboard, CLS rails) — non bloquants souris/voyant → L8.
- **Bundle JS + chargement idle** — gain de perf non bloquant, dépend d'une étape de build → L8.
- **Anneau de focus rouge sur boutons rouges** — medium non critique → regroupé au pass a11y L8.

---

## Risques transverses

1. **Gel frontend Hits Dance** : règle de projet. Seul **L7** (2 critiques JS/HTML localisés) recommandé au dégel. **Ne pas dégeler la dette CSS au coup par coup.**
2. **Dette de cascade CSS Hits Dance** : aucune retouche CSS isolée n'est sûre tant que bundler + tokenisation header/breakpoints ne sont pas faits. Audit visuel après chaque retrait de `!important`.
3. **Refactor de tokens partagés** : enondes a des tokens divergents hub vs pro ; admin a des hex bruts + des `var()` pointant vers des tokens **inexistants** (`--panel2`/`--border` au lieu de `--panel-2`/`--line`) ; Hits Dance `brand.css` réécrit les tokens à l'identique (double maintenance). Centraliser la source de vérité **avant** de relever les contrastes.
4. **Back-office sensible** : Suspendre/Activer patchent le statut **en direct** et coupent les auditeurs → introduire la confirmation modale (L5) avant tout autre changement sur le Parc. Le drawer + migration `RadioEditPanel` touchent des composants partagés → re-tester tous les CRUD.
5. **Effet de bord des pass transverses** : aria-live mal scopé surcharge les annonces (ne pas poser aria-live sur tout le tbody operator ni la grille hub reconstruite). Régions résumé dédiées + préserver le focus (éviter les rebuilds `innerHTML` complets).
6. **Reduced-motion** : chaque animation introduite (point live operator, skeleton admin, barre de progression) doit embarquer sa garde `prefers-reduced-motion` dès l'ajout ; le SMIL `<animate>` de `VisitorMap` ne s'arrête pas via CSS → conditionner en JS.

---

## Séquence recommandée

```
Bloquant lancement :  L1 → L2 → L3 → L4 → L5
Non bloquant      :  L6 → L7
Phase 5 (gelé)    :  L8
```

L1+L2+L3 sont des pass transverses courts et à fort levier (le socle a11y). L4 et L5 finissent de rendre lançables la landing pro et le back-office. L6 polit. L7 est un dégel ciblé à faible risque. L8 attend Phase 5.
