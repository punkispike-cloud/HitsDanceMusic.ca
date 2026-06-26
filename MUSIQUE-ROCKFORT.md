# Kit musique — Rockfort (pilote sans licences commerciales)

> Stratégie 🅱️ du plan : monter une banque musicale rock **légale pour la diffusion** sans payer de
> licences commerciales, en attendant le passage public (où SOCAN + Ré:Sonne deviennent requis).
> Objectif pilote : assez de tounes pour une **rotation 24/7** qui tient la route.

---

## 1. La règle d'or (à retenir)

- **Diffuser ≠ posséder.** Acheter une toune sur iTunes/Bandcamp **ne donne PAS** le droit de la
  diffuser en radio. Pour diffuser de la musique **commerciale** (vrais groupes signés), il faut
  **SOCAN + Ré:Sonne (Tarif 8, guichet Entandem)** — c'est la **Phase 6** (passage public).
- **Pour le pilote**, on utilise **uniquement** de la musique dont la **licence couvre déjà la
  diffusion** : royalty-free, Creative Commons « radio OK », ou **permission écrite directe** d'un
  groupe. Légal, gratuit (ou abo modeste), et **on-brand** pour une radio rock indé.
- ❌ Jamais de rips Spotify/YouTube/CD commerciaux — illégal sans les licences ci-dessus.

---

## 2. Où trouver du rock diffusable

| Source | Type de licence | Ce que ça permet | Coût | Catalogue rock |
|---|---|---|---|---|
| **Uppbeat** | Royalty-free | Diffusion / streaming incluse | Palier **gratuit** + Premium ~7 $US/mo | Rock, punk, garage, metal léger |
| **Jamendo Licensing** | CC + licence radio commerciale | **Webradio explicitement couverte** | Abo « In-Store/Radio » | Large, beaucoup d'indé rock |
| **Free Music Archive (FMA)** | Creative Commons (vérifier par piste) | Diffusion si licence le permet (CC-BY / CC-BY-SA) | **Gratuit** | Rock/punk/indé, qualité variable |
| **ccMixter** | Creative Commons | Diffusion selon licence | **Gratuit** | Indé, remixes |
| **Epidemic Sound / Artlist / Soundstripe** | Royalty-free (abo) | Diffusion incluse | ~15–25 $US/mo | Rock soigné, « production » |
| **Bandcamp (groupes indé)** | À négocier directement | Seulement avec **permission écrite** (voir §3) | Gratuit (geste de bonne foi possible) | ⭐ Le meilleur angle rock QC |

**Conseil pratique :** pour le pilote, combine **Uppbeat/FMA (backbone gratuit)** + **5–10 groupes
indé QC avec permission écrite** (§3). Tu as une banque légale, variée, et une vraie identité locale.

> ⚠️ Pour les pistes **Creative Commons**, garde une trace de la licence (CC-BY exige souvent de
> **créditer l'artiste**) — note l'attribution dans les métadonnées de la toune ou une page crédits.

---

## 3. Courriel-type — demande de diffusion à un groupe indé

> Pour les groupes rock émergents (Bandcamp, scène locale). Beaucoup **veulent** du airplay. Adapte
> `[…]`. Vise les émissions *Garage QC*, *Indé d'ici*, *Live Sessions*.

```
Objet : Rockfort aimerait faire jouer [NOM DU GROUPE] en ondes

Bonjour [NOM / le band],

Je lance Rockfort, une radio web rock (classiques, hard, indé) qui met de l'avant la scène
d'ici. J'ai accroché sur [TITRE / EP / album] — exactement le genre de son qu'on veut faire
tourner.

Est-ce que vous m'autoriseriez à diffuser vos chansons sur Rockfort ? Concrètement :
  • diffusion en continu sur notre flux web (rotation + émissions comme « Garage QC »
    et « Indé d'ici ») ;
  • crédit à l'antenne et lien vers votre Bandcamp / réseaux quand on vous fait jouer ;
  • aucune exclusivité, vous restez 100 % propriétaires ; vous pouvez retirer l'accord
    quand vous voulez.

Si ça vous va, un simple « oui, vous avez notre permission de diffuser [titres/album] sur
Rockfort » par courriel me suffit comme autorisation écrite. Vous pouvez aussi m'envoyer les
fichiers en bonne qualité (MP3 320 ou WAV/FLAC) si vous préférez.

Merci, et au plaisir de vous faire tourner !
[TON NOM] — Rockfort
[courriel] · [site/Instagram]
```

**À conserver :** garde chaque « oui » par courriel dans un dossier `permissions/` (preuve d'autorisation).

---

## 4. Organiser la banque chez l'hébergeur (AutoDJ)

Téléverse les MP3, puis crée des **playlists par ambiance**, alignées sur les émissions Rockfort
(`api/src/db/seed-rockradio.ts`). Pour le pilote, **une rotation mélangée 24/7 suffit** ; ces
playlists te serviront ensuite à la planification horaire fine (Phase 6) :

| Playlist | Ambiance | Émissions alimentées |
|---|---|---|
| **Classic Rock** | Classiques, gros riffs | Réveil Distorsion, Légendes du Riff, Rotation Rock |
| **Hard & Metal** | Metal, hard, stoner | Heavy Hour, Autoroute 666 (nuit) |
| **Indé / Garage QC** | Émergent, punk, garage, local | Garage QC, Indé d'ici, Live Sessions |
| **Acoustique / Doux** | Café, acoustiques, ballades | Café Granite, Power Ballades |
| **Deep Cuts / Vinyle** | Faces B, raretés | Vinyle & Whisky |

**Cible pilote réaliste :** ~80–150 pistes au total (rotation qui ne se répète pas trop vite), avec
des **jingles/IDs Rockfort** entre les blocs (l'hébergeur permet de les insérer en cadence).

---

## 5. Checklist musique — pilote

- [ ] Ouvrir un compte sur **1 source backbone** (Uppbeat gratuit ou Jamendo).
- [ ] Télécharger 60–100 pistes rock variées (classic / hard / indé / acoustique).
- [ ] Contacter **5–10 groupes indé QC** (courriel §3) → récolter les « oui » écrits.
- [ ] Noter les **attributions CC** requises.
- [ ] Téléverser le tout chez l'hébergeur + activer l'**AutoDJ** (rotation 24/7).
- [ ] (Optionnel) enregistrer 2–3 **jingles Rockfort** (« Rockfort — le rock comme dans l'temps »).

➡️ Une fois la rotation qui joue chez l'hébergeur, tu récupères `STREAM_URL` + `NOWPLAYING_URL`
(**Phase 2**) et je branche tout (**Phase 3–4**).
