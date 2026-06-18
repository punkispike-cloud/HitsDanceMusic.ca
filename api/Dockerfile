# ─── Build stage : compile TypeScript → dist/ ───
FROM node:20-alpine AS build
WORKDIR /app

# Manifests d'abord pour profiter du cache de couches Docker
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build
# Retire les devDependencies pour alléger l'image finale
RUN npm prune --omit=dev

# ─── Runtime stage : image minimale ───
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
# Railway surcharge PORT dynamiquement
ENV PORT=8082

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/package.json ./package.json

EXPOSE 8082
USER node

CMD ["node", "dist/index.js"]
