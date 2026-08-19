# En Ondes — Hub d'écoute. Déploiement statique nginx (Railway), même patron
# que la racine. Build depuis le dossier enondes-site/ comme contexte.
FROM nginx:alpine

# Config nginx (statique + sécurité + proxy /np par station)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Site (hub). Le nginx.conf est aussi copié mais nginx ne sert pas /nginx.conf
# (aucune route ne l'expose ; à la racine on pourrait l'exclure si besoin).
COPY . /usr/share/nginx/html

# Exécution non-root (audit 2026-08-16, G7) : le user nginx doit pouvoir
# modifier la conf au démarrage (sed du PORT) et écrire pid/cache/logs.
RUN chown -R nginx:nginx /etc/nginx/conf.d /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

# Railway fournit la variable PORT
ENV PORT=8080
EXPOSE 8080

USER nginx

# API_UPSTREAM_HOST (optionnel) : hôte API du proxy /api/. Sans la variable,
# l'upstream reste la prod (défaut du nginx.conf). À poser sur le service
# staging (patient-endurance-staging.up.railway.app) pour que les tests du
# catalogue n'écrivent pas dans la base de production.
CMD ["sh", "-c", "sed -i \"s/listen 8080;/listen $PORT;/\" /etc/nginx/conf.d/default.conf && if [ -n \"$API_UPSTREAM_HOST\" ]; then sed -i \"s/patient-endurance-production-21c8\\.up\\.railway\\.app/$API_UPSTREAM_HOST/g\" /etc/nginx/conf.d/default.conf; fi && nginx -g 'daemon off;'"]
