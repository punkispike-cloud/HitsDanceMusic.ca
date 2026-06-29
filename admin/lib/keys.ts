/* Helper PUR de construction de clés SWR pour les données radio-scopées.
   La clé inclut `selectedRadioId` comme discriminant → changer de radio change
   la clé → SWR re-fetch la nouvelle radio sans remont du sous-arbre (plus
   d'`epoch`). Pour les non-cross-radio, selectedRadioId est null (la radio vient
   du JWT) : la clé `[..., null]` est partagée et le fetch part sans X-Radio-Id.

   `scope` est l'espace de nom du cache (ici, le chemin API complet, query
   incluse) ; `path` est un discriminant supplémentaire optionnel (ex. id de
   ressource). Le 1er élément du tuple est toujours le chemin GET → le fetcher
   global (lib/swr.tsx) l'extrait pour `api.get`.

   Testé en pur dans tests/keys.test.ts (aucun import React/DOM). */

export function rkey(
  scope: string,
  selectedRadioId: string | null,
  path?: string,
) {
  return path ? [scope, selectedRadioId, path] as const : [scope, selectedRadioId] as const;
}
