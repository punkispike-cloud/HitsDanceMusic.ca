/* Tests des tokens (sécurité-critique) : un access token valide doit se
   vérifier ; tout token altéré/malformé/expiré doit être rejeté. Le hash des
   refresh tokens doit être déterministe et ne jamais exposer le brut. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from "../src/lib/jwt.ts";

const claims = { sub: "user-123", role: "animateur" as const, artistId: "artist-9" };

test("access token : aller-retour sign → verify conserve les claims", async () => {
  const token = await signAccessToken(claims);
  const decoded = await verifyAccessToken(token);
  assert.ok(decoded, "le token valide doit se vérifier");
  assert.equal(decoded.sub, claims.sub);
  assert.equal(decoded.role, claims.role);
  assert.equal(decoded.artistId, claims.artistId);
});

test("access token : signature altérée → rejet (null)", async () => {
  const token = await signAccessToken(claims);
  // Corrompt le dernier caractère de la signature.
  const tampered = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
  assert.equal(await verifyAccessToken(tampered), null);
});

test("access token : chaîne malformée → rejet (null)", async () => {
  assert.equal(await verifyAccessToken("pas.un.jwt"), null);
  assert.equal(await verifyAccessToken(""), null);
  assert.equal(await verifyAccessToken("a.b"), null);
});

test("access token : émis avec un AUTRE secret → rejet", async () => {
  const foreign = new TextEncoder().encode("un-autre-secret-completement-different-123456");
  const token = await new SignJWT({ role: "superadmin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("intrus")
    .setIssuer("hitradio-api")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(foreign);
  assert.equal(await verifyAccessToken(token), null, "un token d'un autre secret ne doit jamais passer");
});

test("access token : mauvais issuer → rejet", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ role: "superadmin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("u")
    .setIssuer("autre-emetteur")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
  assert.equal(await verifyAccessToken(token), null);
});

test("access token : expiré → rejet", async () => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT({ role: "lecteur" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("u")
    .setIssuer("hitradio-api")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60) // expiré il y a 1 min
    .sign(secret);
  assert.equal(await verifyAccessToken(token), null);
});

test("refresh token : hash déterministe, brut jamais exposé", () => {
  const raw = generateRefreshToken();
  assert.match(raw, /^[A-Za-z0-9_-]+$/, "base64url");
  const h1 = hashRefreshToken(raw);
  const h2 = hashRefreshToken(raw);
  assert.equal(h1, h2, "même entrée → même hash");
  assert.match(h1, /^[a-f0-9]{64}$/, "SHA-256 hex");
  assert.notEqual(h1, raw, "le hash ne doit pas être le brut");
  assert.notEqual(hashRefreshToken(generateRefreshToken()), h1, "deux tokens → deux hash");
});
