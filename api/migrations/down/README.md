# Retours arrière de migrations

Un fichier ici annule la migration du même nom : `down/0033_x.sql` défait
`0033_x.sql`.

**Ce dossier est vide, et c'est normal.** Aucune des 32 migrations actuelles ne
détruit de donnée — les seuls `DROP` sont dans `0009`, qui supprime sept index
pour les recréer portés sur `(radio_id, slug)`. Un index se reconstruit depuis
le schéma ; il ne se perd pas.

Écrire rétroactivement 32 fichiers `down` pour des migrations purement additives
serait du travail mort : leur annulation est un `DROP` évident, et un fichier
jamais exécuté n'est pas un rollback, c'est une intention.

## Quand un fichier devient obligatoire

`npm run migrations:guard` (en CI, job *tenant-guard*) échoue si une migration
contient l'un de ces motifs sans fichier `down/` correspondant :

| Motif | Pourquoi |
|---|---|
| `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA` | perte directe |
| `DELETE FROM`, `TRUNCATE` | perte directe |
| `ALTER COLUMN … TYPE` | une conversion peut tronquer |
| `ALTER COLUMN … SET NOT NULL` | échoue sur données existantes sans backfill |

Ne comptent **pas** : `DROP INDEX`, `DROP CONSTRAINT`, `DROP POLICY`,
`DROP TRIGGER`. Ce sont des objets dérivés, reconstructibles mécaniquement.

## Écrire un fichier `down`

1. Même nom de fichier que la migration montante.
2. Le SQL qui rétablit l'état antérieur — structure **et** données quand c'est
   possible (une colonne supprimée ne se ré-remplit pas : dans ce cas, la
   migration montante doit d'abord copier la donnée ailleurs).
3. **L'exécuter au moins une fois** sur une base jetable. Un rollback jamais
   joué n'est pas un rollback.

## Ce que ce dossier ne remplace pas

Le rollback global — PITR + sauvegarde quotidienne (`backup.yml`, 7h17 UTC) —
ramène **toute** la base à un instant. Il ne peut pas annuler une seule
migration, et l'incident du 17 août 2026 (restauration PITR à moitié appliquée,
base repartie vide) montre que ce chemin se répète mal sous pression.

Procédure complète : `RUNBOOK-PRODUCTION.md` § Migration destructive.
