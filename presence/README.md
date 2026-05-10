# Hits Dance Music — Presence Service

Mini-service Node.js qui compte en temps réel :
- 👥 **visiteurs** sur le site (= connexions WebSocket actives)
- 🎧 **auditeurs** (= clients ayant signalé `listening: true`)

## Déploiement Railway (recommandé)

1. Dans le projet Railway de Hits Dance Music, clique **+ New → GitHub Repo → HitsDanceMusic.ca**.
2. Une fois le service créé, va dans **Settings → Source** et règle :
   - **Root Directory** : `presence`
   - **Builder** : Dockerfile (auto-détecté)
3. Dans **Variables**, ajoute :
   - `ALLOWED_ORIGINS` = `https://hitsdancemusic.ca,https://www.hitsdancemusic.ca,https://<ton-projet>.up.railway.app`
   (sépare par virgules ; mets `*` en dev seulement)
4. Dans **Settings → Networking → Public Networking**, clique **Generate Domain**.
   Tu obtiens une URL du genre `presence-production-xxxx.up.railway.app`.
5. Dans le site principal, ouvre les `.html` et remplace le placeholder dans :
   ```html
   <meta name="hr-presence-url" content="wss://TON-URL/ws/presence" />
   ```
6. Redeploie le service principal. Le compteur s'allume tout seul.

## Local

```bash
cd presence
npm install
npm start
# → écoute sur http://localhost:8081/ws/presence
```

Pour tester depuis ton site en local, mets temporairement :
```html
<meta name="hr-presence-url" content="ws://localhost:8081/ws/presence" />
```

## Endpoints

- `GET /health` → `{ ok, visitors, listeners }` (pour monitoring)
- `WS /ws/presence` → canal WebSocket client

## Variables d'environnement

| Var | Défaut | Description |
|---|---|---|
| `PORT` | 8081 | Port d'écoute (Railway le surcharge) |
| `ALLOWED_ORIGINS` | `*` | Origines autorisées, virgules. **Mets une whitelist en prod.** |

## Sécurité

- Vérifie l'`Origin` HTTP des connexions (`ALLOWED_ORIGINS`)
- Rate-limit 10 messages/s par client (anti-flood)
- Limite payload à 256 octets
- Heartbeat 25 s + terminaison auto des connexions zombies
