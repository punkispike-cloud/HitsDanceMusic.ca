#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# En Ondes · installation d'AzuraCast (moteur de flux, derrière la marque)
#
# À lancer EN ROOT sur ton SERVEUR (Hetzner/OVH, Ubuntu 22.04 ou 24.04 frais),
# PAS sur ta machine perso :
#     ssh root@<IP-DU-SERVEUR>
#     bash install-azuracast.sh
#
# Le script installe Docker + AzuraCast (méthode officielle). La configuration
# (assistant web, clé API, HTTPS) se fait ensuite dans le navigateur — voir
# INSTALL-AZURACAST.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "❌ Lance ce script en root (sudo)." >&2
  exit 1
fi

echo "== En Ondes · installation d'AzuraCast =="

# 1. Mise à jour système + utilitaires de base
apt-get update -y
apt-get upgrade -y
apt-get install -y curl ca-certificates

# 2. Dossier officiel d'AzuraCast
mkdir -p /var/azuracast
cd /var/azuracast

# 3. Script d'installation officiel (installe Docker puis AzuraCast)
curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh > docker.sh
chmod a+x docker.sh

# 4. Installation (INTERACTIF : réponds aux questions ; garde les ports 80/443)
./docker.sh install

echo ""
echo "✅ AzuraCast installé."
echo "   Prochaine étape : ouvre http://<IP-DU-SERVEUR> dans ton navigateur"
echo "   pour l'assistant de configuration, puis génère une clé API."
echo "   (Détails : INSTALL-AZURACAST.md)"
