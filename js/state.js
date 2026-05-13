/* État partagé entre modules : créneau courant, morceau live, pochette,
   ainsi qu'une clé pour éviter d'ajouter 2× le même morceau à l'historique.
   Utilise un objet plutôt qu'`export let` pour permettre une mutation
   cross-module simple. */

export const state = {
  currentSlot: null,
  currentTrack: null,
  currentCover: null,
  lastTrackKey: "",
};
