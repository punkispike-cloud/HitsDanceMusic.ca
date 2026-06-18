import { defineConfig } from "drizzle-kit";

/* Configuration drizzle-kit : génère le SQL versionné dans ./migrations
   à partir de src/db/schema.ts. La source de vérité du schéma reste le code. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
