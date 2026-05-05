FROM nginx:alpine

# Config nginx custom pour SPA-friendly + bons MIME + port Railway
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copie du site
COPY . /usr/share/nginx/html

# Railway fournit la variable PORT
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "sed -i \"s/listen 8080;/listen $PORT;/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
