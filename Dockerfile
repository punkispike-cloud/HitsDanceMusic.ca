FROM nginx:alpine

# Config nginx custom pour SPA-friendly + bons MIME + port Railway
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copie du site
COPY . /usr/share/nginx/html

# Exécution non-root (audit 2026-08-16, G7) : le user nginx (fourni par
# l'image) doit pouvoir modifier la conf au démarrage (sed du PORT) et
# écrire pid/cache/logs. Le port 8080 est non privilégié, aucune cap requise.
RUN chown -R nginx:nginx /etc/nginx/conf.d /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

# Railway fournit la variable PORT
ENV PORT=8080
EXPOSE 8080

USER nginx

CMD ["sh", "-c", "sed -i \"s/listen 8080;/listen $PORT;/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
