/* Préchargé avant les tests (`node --test --import ./tests/_setup.ts`).
   Fournit les variables d'env minimales pour que src/env.ts valide sans
   échouer. Aucune connexion DB n'est ouverte par ces tests (les modules
   testés — jwt, rbac, validation — n'importent pas db/client). */

process.env.NODE_ENV ??= "test";
process.env.JWT_SECRET ??= "test-only-secret-test-only-secret-0123456789"; // ≥ 32
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test_db";
