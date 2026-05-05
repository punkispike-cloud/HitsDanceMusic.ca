# Hit Radio — Les Hits Dance Music

Site statique (HTML / CSS / JS) pour la landing page et quelques pages satellites. Aucun backend : le lecteur lit directement le flux SHOUTcast.

## Fichiers principaux

- `index.html` — accueil : hero, lecteur live, grille **programmation 2026** (7 jours), équipe, contact **Alain Perron** · **418 261‑2886**.
- `styles.css` — thème **lounge** noir / rouge, navigation mobile, sections glass.
- `script.js` — lecture / pause **sur la page** (pas de navigation vers le flux), volume, menu burger &lt; 900px ; le bouton « Écouter sur la page » en bas d’accueil fait défiler vers `#player` et lance le direct.
- `assets/favicon.svg` — favicon **HR**.
- `assets/radio-studio-hero.svg` — visuel hero (overlay assombri en CSS).

Pages optionnelles : `animateurs.html`, `horaire.html` (lien vers la grille sur l’accueil), `emissions.html`, `contact.html`.

## Flux radio

Le flux est défini dans `index.html` :

```text
https://cast5.asurahosting.com/start/hitsdanc/
```

L’élément `<audio>` lit ce flux **sans quitter la landing** ; le lien « Ouvrir dans un autre onglet » charge uniquement la page du fournisseur dans un second onglet. Pas d’attribut `crossorigin` sur `<audio>` : sinon beaucoup de flux Icecast / SHOUTcast refusent la lecture (CORS).

Depuis les pages satellites, la barre **Écouter le direct** pointe vers `index.html?play=1#player` : à l’arrivée sur l’accueil, le lecteur défile à l’écran et la lecture démarre (puis le paramètre `play` est retiré de l’URL pour éviter une relance au rafraîchissement).

## Déploiement

1. Téléverse **tout le dossier** à la racine de ton hébergement (ou branche un dépôt Git vers **Netlify**, **Cloudflare Pages**, **GitHub Pages**, **Vercel** en mode site statique).
2. Sert le site en **HTTPS** pour éviter les blocages « mixed content » sur le flux audio.
3. Pour les partages sociaux (`og:image`), remplace l’URL relative dans les balises Open Graph par une **URL absolue** du type `https://tondomaine.com/assets/radio-studio-hero.svg` (ou une image PNG carrée dédiée).

## Checklist avant mise en ligne

- [ ] Tous les fichiers listés ci‑dessus sont présents ; aucun `src` / `href` local ne pointe vers un fichier manquant.
- [ ] Le flux audio joue après un clic sur « lecture » (politique des navigateurs).
- [ ] Menu mobile : ouverture / fermeture, lien **Contact** et ancres fonctionnent.
- [ ] Coordonnées studio à jour (téléphone, e‑mail `mailto:` si tu en ajoutes un réel).
- [ ] `og:image` en URL absolue une fois le domaine connu.

## Modifier le contenu

- Marque : chercher `Hit Radio` et `Les Hits Dance Music`.
- Grille : blocs `<details class="day-block">` dans `index.html`.
- Lecteur : textes d’état dans `script.js`.

## Ouvrir en local

Ouvre `index.html` dans un navigateur ou lance un petit serveur statique dans ce dossier pour tester sans restriction CORS éventuelle sur le flux.
