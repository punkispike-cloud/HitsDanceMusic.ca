# Installer AzuraCast (moteur de flux En Ondes) — pas à pas

> AzuraCast = logiciel libre, **auto-hébergé sur TON serveur**, invisible pour le
> client. Il fait la diffusion (Icecast) + l'AutoDJ (Liquidsoap). En Ondes le
> pilote par son API : à la création d'une radio, la station se monte toute seule.

---

## 1. Choisir le serveur (⚠️ le poste de coût, c'est la bande passante)

- **Hébergeur à bande passante à plat** : Hetzner, OVH. **JAMAIS** un hyperscaler
  facturé à l'egress (100 auditeurs 24/7 ≈ 25 To/mois = ~5 € chez Hetzner vs ~2 250 $ sur AWS).
- **CPU dédié** (le transcodage tourne 24/7) : Hetzner **CCX13 / CCX23** (vCPU dédié)
  ou OVH équivalent. Évite les VPS « shared CPU » au-delà de quelques stations.
- **OS** : Ubuntu **22.04** ou **24.04** (fraîche).
- Reco départ : ~4–8 Go RAM, 2 vCPU dédiés, 80 Go SSD.

---

## 2. DNS

Crée un enregistrement **A** : `stream.enondes.ca` → l'IP du serveur.
(C'est ce sous-domaine que les auditeurs et En Ondes utiliseront.)

---

## 3. Installer AzuraCast

Sur ta machine, copie le script sur le serveur puis lance-le **en root** :
```bash
scp scripts/install-azuracast.sh root@<IP-SERVEUR>:/root/
ssh root@<IP-SERVEUR>
bash install-azuracast.sh
```
Le script installe Docker + AzuraCast (méthode officielle). Réponds aux questions
de l'installateur (garde les **ports 80/443** par défaut). ~5–10 min.

> Manuellement, c'est juste : `mkdir -p /var/azuracast && cd /var/azuracast && curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh > docker.sh && chmod a+x docker.sh && ./docker.sh install`

---

## 4. Configuration web (assistant)

1. Ouvre **http://<IP-SERVEUR>** → l'assistant AzuraCast démarre.
2. Crée le **compte super-administrateur** (ton compte maître AzuraCast).
3. À l'étape « Base URL » / **System Settings**, mets `https://stream.enondes.ca`
   et **active Let's Encrypt** (HTTPS automatique). AzuraCast gère le certificat.
4. Tu peux **sauter** la création d'une station ici : En Ondes les créera par API.

---

## 5. Générer la clé API (pour En Ondes)

1. Connecté en super-admin → **icône profil → My Account → API Keys**.
2. **Create New API Key** → copie la clé (tu ne la reverras plus).
3. C'est ta `AZURACAST_API_KEY`.

---

## 6. Brancher dans En Ondes

Sur le service `api` (Railway, ton instance de test ou prod), ajoute :
```
AZURACAST_BASE_URL=https://stream.enondes.ca
AZURACAST_API_KEY=<la clé de l'étape 5>
```
→ Redeploy l'api.

---

## 7. Tester le provisioning automatique

1. Admin En Ondes → login owner → **Parc → Provisionner une nouvelle radio**.
2. À la création, En Ondes appelle l'API AzuraCast → **une station se crée** (Icecast + AutoDJ),
   et son flux + now-playing sont câblés au tenant (`streamUrl` / `nowPlayingUrl`).
3. Vérifie dans l'admin AzuraCast (`https://stream.enondes.ca`) que la station apparaît.
4. Côté client : il gère sa musique / playlists / AutoDJ / DJ live dans AzuraCast (accès à ses couleurs),
   pendant qu'En Ondes gère le site, la marque, la grille, les podcasts, les stats.

---

## 8. Exploitation (à savoir)

- **Mises à jour** : `cd /var/azuracast && ./docker.sh update` (ou Watchtower auto).
- **Sauvegardes** : AzuraCast a des backups natifs (Administration → Backups) → planifie-les.
- **HTTPS** : renouvellement Let's Encrypt automatique.
- **Quotas** : par station (espace média, bitrate) selon le forfait du client.
- ⚖️ **Licences (non négociable)** : chaque radio cliente doit détenir **SOCAN + Re:Sound
  (Tarif 8, via Entandem)**. C'est au client (déjà dans `_private/CONTRAT-CLIENT.md` + `ATTESTATION-LICENCES.md`).

---

## En cas d'échec du provisioning

L'erreur exacte d'AzuraCast est renvoyée dans la réponse (`station.error`) — En Ondes
inclut désormais le détail du corps + un message « timeout (15s) » si le serveur ne répond pas.
Vérifie : la clé API valide, `AZURACAST_BASE_URL` joignable depuis Railway (https + DNS OK),
et les droits admin de la clé.
