# En Ondes — Hub d'écoute. Déploiement statique nginx (Railway), même patron
# que la racine. Build depuis le dossier enondes-site/ comme contexte.
FROM nginx:alpine

# Config nginx (statique + sécurité + proxy /np par station)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Site (hub). Le nginx.conf est aussi copié mais nginx ne sert pas /nginx.conf
# (aucune route ne l'expose ; à la racine on pourrait l'exclure si besoin).
COPY . /usr/share/nginx/html

# Railway fournit la variable PORT
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "sed -i \"s/listen 8080;/listen $PORT;/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
