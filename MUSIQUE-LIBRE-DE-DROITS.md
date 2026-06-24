# Musique libre de droits pour une radio En Ondes (sourcing → antenne)

> Comment monter une banque de **300-400 pistes** légales (instrumentales **et chantées**),
> comment elles **arrivent à l'antenne** via le moteur (AutoDJ), et pourquoi En Ondes n'a
> **pas** — volontairement — d'AutoDJ maison. Sœurs de ce doc :
> [LANCEMENT-ROCKFORT.md](LANCEMENT-ROCKFORT.md) (pilote sans AzuraCast) et
> [FLUX-CLIENT-SANS-FLUX.md](FLUX-CLIENT-SANS-FLUX.md) (client sans flux, via AzuraCast).

---

## 0. Le malentendu à dissiper : les pistes ne vont PAS « dans En Ondes »

En Ondes **ne stocke jamais** la musique de rotation 24/7. Il **lit** un flux produit ailleurs.

```
  TES MP3 (FMA/Pixabay/…)        LE MOTEUR (AutoDJ)               EN ONDES (déjà prêt)
  ┌──────────────────┐  upload   ┌───────────────────────┐         ┌────────────────────┐
  │ 300-400 pistes   │ ────────► │ AzuraCast (Liquidsoap) │  flux   │ brand/<radio>.json │
  │ rangées en       │ SFTP /    │  OU hébergeur web      │ ──────► │  stream.url        │
  │ dossiers=playlist│ glisser   │  (AsuraHosting, …)     │  titre  │  nowPlayingUrl     │
  └──────────────────┘           │  ⇒ l'AutoDJ joue 24/7  │ ──────► │  ⇒ le SITE les lit │
                                 └───────────────────────┘         └────────────────────┘
```

« Intégrer les pistes » = les **téléverser dans le moteur** (AzuraCast → *Music Files* / SFTP,
ou le panneau de ton hébergeur), y bâtir les **playlists**, et l'AutoDJ tourne. En Ondes ne fait
que **pointer** `stream.url` + `nowPlayingUrl` sur le résultat (déjà câblé).

> **Seule exception :** les **podcasts / mixes à la demande** se téléversent, eux, dans En Ondes
> (admin → upload S3). Ça, c'est du **on-demand**, pas la rotation live. Ne pas confondre.

---

## 1. Pourquoi pas d'AutoDJ maison (choix d'architecte, pas une limite)

**On en a déjà un — deux, même :**
- **Liquidsoap**, dans **AzuraCast**, qu'on provisionne **par code**
  ([azuracast.ts](api/src/services/azuracast.ts) → `backend_type: "liquidsoap"`).
- L'**AutoDJ web de l'hébergeur** (AsuraHosting / RadioKing…) pour le mode pilote.

Ce qu'on **ne réécrit pas**, c'est le moteur audio dans l'app En Ondes :

| Réécrire un AutoDJ maison | S'appuyer sur Liquidsoap / AzuraCast (intégré) |
|---|---|
| Crossfade, gapless, ReplayGain, planification, bascule DJ live, failover, transcodage 24/7 = **des années d'ingénierie** | Tout ça **gratuit, éprouvé, open-source** |
| Bugs audio en prod, à notre charge | On ne paie que la **bande passante** |
| **Zéro avantage business** | Le revenu est dans l'**hébergement/service**, pas le moteur |

> En clair : on s'appuie sur le meilleur AutoDJ du marché au lieu d'en bricoler un moins bon.

---

## 2. Le filtre de licence (la règle d'or)

Une radio En Ondes héberge des clients **payants** → usage **commercial**. Donc :

| Licence | Radio commerciale ? | Note |
|---|---|---|
| **CC0** (domaine public) | ✅ Oui, zéro condition | Le Graal |
| **CC-BY** | ✅ Oui, **avec crédit** | Le now-playing affiche déjà Artiste + Titre → **attribution satisfaite à l'écran** |
| **CC-BY-NC** | ❌ **NON** | « NC » = non-commercial → interdit chez nous |
| **CC-BY-ND** | ⚠️ OK pour diffuser tel quel | « ND » = pas de remix/montage |
| **Pixabay License** | ✅ Oui, sans attribution | *Broadcast-friendly*, usage commercial libre |

**Retiens : prends CC0, CC-BY et Pixabay. Jette tout ce qui porte « NC ».**

---

## 3. Les sources — avec une colonne VOIX (le vrai défi)

L'instrumental libre de droits est partout ; les **vraies chansons chantées** le sont beaucoup moins.

| Source | Voix ? | Coût | Pour quoi |
|---|---|---|---|
| **Pixabay Music** | ⚠️ surtout instru | Gratuit, sans attribution | 🥇 Le fond de rotation instrumental, licence *broadcast* limpide |
| **Free Music Archive** | ✅✅ 100 000+ titres, **vrais artistes** | Gratuit (licence/piste affichée) | 🥇 **La source #1 pour du vocal.** Filtrer CC0/CC-BY, genres *Pop / Rock / Singer-Songwriter / Soul-RnB / Hip-Hop / Folk* |
| **Jamendo Licensing** | ✅✅ (playlist « CC Music With Vocals ») | Payant (par piste/forfait) | 🥈 **Le plus blindé** : garantit « aucune redevance à un PRO/société de gestion » → bouclier SOCAN/Ré:Sonne |
| **Internet Archive** | ✅ live, netlabels, domaine public | Gratuit | Rock live, vintage, **angle Garage-QC** |
| **ccMixter / dig.ccMixter** | ✅ chansons + acappellas | Gratuit (CC) | Complément vocal original |
| **Bandcamp** (groupes QC) | ✅✅ vraies chansons d'ici | Permission directe | ⭐ Le local authentique (garder le « oui » par courriel) |

**À éviter pour une radio :**
- ❌ **YouTube Audio Library** — licence valable **sur YouTube seulement** ; hors YouTube, il faut
  l'accord de chaque artiste. Illégal à l'antenne.
- ❌ **NCS (NoCopyrightSounds)** — la licence gratuite **ne couvre pas** une radio musicale ; licence
  commerciale requise sur demande.
- ❌ **Epidemic Sound / Artlist / Soundstripe** — **excluent** la radio Internet de leurs forfaits
  standards (palier *business/enterprise* requis).

---

## 4. Trouver du VOCAL concrètement sur Free Music Archive

Il n'y a pas de bouton « voix » → la méthode :

1. **FMA → Genres** chantés : *Pop, Rock, Singer-Songwriter, Soul-RnB, Hip-Hop, Folk*
   (éviter *Instrumental, Ambient, Soundtrack, Electronic*, souvent sans voix).
2. **Vérifier la licence** sur chaque piste → garder **CC0 / CC-BY**, écarter tout « NC ».
3. Écouter 15 s, télécharger, **garder les tags ID3 propres** (Artiste + Titre = ce que l'antenne affiche).
4. **Mélanger les sources** (FMA + Pixabay + Internet Archive + Bandcamp QC) → 300-400 titres **sans
   répétition** et avec du caractère, au lieu de 400 pistes de la même banque qui sonnent « ascenseur ».

> ⚠️ Pixabay : **pas d'API musique** et **scraping interdit** par ses conditions → téléchargement
> **manuel** uniquement. Astuce : compte gratuit + bouton ♥ comme file d'attente, puis téléchargement
> en lot depuis la page *Likes*.

---

## 5. Ranger la banque avant l'upload — `scripts/organize-music.mjs`

Range tes MP3 en **sous-dossiers = playlists** (cf. la structure Rockfort), puis lance l'outil de
contrôle qualité (lecture seule, zéro dépendance, zéro réseau) :

```bash
node scripts/organize-music.mjs ./music
node scripts/organize-music.mjs "D:/radio/banque-rockfort" --min-hours=2
```

Structure conseillée (calquée sur la grille) :

```
/music
  /Rotation-Rock   ← classic rock (le fond 24/7)
  /Heavy           ← métal / hard / stoner
  /Garage-QC       ← punk / garage / indé local (Bandcamp + Archive)
  /Deep-Cuts       ← faces B, classiques rares
  /Ballades        ← power ballads
  /Jingles         ← idents station (5-10 s)
```

Ce que le script te sort :
- **Durée totale par dossier** (cible ~15-20 h pour 300-400 pistes) — estimation MPEG/Xing (`~`).
- **Pistes sans Artiste/Titre** → now-playing vide à l'antenne ⇒ corrige-les (**Mp3tag**, gratuit, Windows).
- **Doublons** probables (même artiste + titre).
- **`music-report.csv`** = **journal d'attribution** : colonnes `source` (FMA/Pixabay/Bandcamp…)
  et `licence` (CC0/CC-BY…) à remplir → **ta preuve de conformité**.

---

## 6. Téléverser dans le moteur (l'« intégration »)

### Voie A — client avec AzuraCast (cf. [FLUX-CLIENT-SANS-FLUX.md](FLUX-CLIENT-SANS-FLUX.md) §4-6)
1. Admin AzuraCast → station → **Music Files** : glisser-déposer, ou **SFTP** (FileZilla) pour le volume.
2. Reproduire l'arborescence `/Rotation-Rock`, `/Heavy`… → **Playlists** (General Rotation + ambiances).
3. L'**AutoDJ (Liquidsoap)** joue 24/7. Le mount Icecast + `/api/nowplaying/<shortName>` sont **déjà
   câblés** sur le tenant par le provisioning.

### Voie B — pilote sans AzuraCast (cf. [LANCEMENT-ROCKFORT.md](LANCEMENT-ROCKFORT.md) §2-3)
1. Hébergeur radio clé en main → téléverser les MP3, bâtir les playlists dans son panneau.
2. Récupérer l'**URL de flux** + le **now-playing** → les poser dans `brand/<radio>.json`
   (`stream.url`, `stream.nowPlayingProxy`), rebuild + redeploy.

Dans les deux cas, **En Ondes ne change pas** : il lit `stream.url` (lecteur) + `nowPlayingUrl` (titre).

---

## 7. Licences de diffusion (mode pilote → public)

- **Pilote, musique CC0/CC-BY/Pixabay/permission directe** : rien à payer, c'est propre.
- **Passage à de la musique commerciale en public** : SOCAN + Ré:Sonne (Tarif 8 / Entandem) par station —
  aucun logiciel n'en exonère. Réf. [_private/ATTESTATION-LICENCES.md](_private/ATTESTATION-LICENCES.md).
- **Argument de vente** : un forfait « antenne clé en main, **musique incluse, sans licence** » adossé à
  **Jamendo Licensing** (zéro redevance à une société de gestion) débloque le client qui n'a ni musique
  ni licence.

---

## Récap — qui fait quoi

| # | Étape | Réf |
|---|---|---|
| 1 | Choisir les sources (vocal = FMA + Bandcamp QC ; fond = Pixabay) | §3-4 |
| 2 | Télécharger 300-400 pistes, tags ID3 propres, licences CC0/CC-BY | §2-4 |
| 3 | Ranger en dossiers=playlists + `node scripts/organize-music.mjs` | §5 |
| 4 | Téléverser dans le moteur (AzuraCast ou hébergeur) + playlists | §6 |
| 5 | Vérifier flux + now-playing dans En Ondes (déjà câblé) | §6 |
| 6 | Remplir le journal d'attribution (CSV) = preuve de conformité | §5 |
