FROM node:20-alpine

WORKDIR /app

# Copie manifests d'abord pour cache Docker
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copie le code
COPY . .

# Railway fournit PORT dynamiquement
ENV NODE_ENV=production
ENV PORT=8081
EXPOSE 8081

USER node

CMD ["node", "server.js"]
