-- Uploads : nouvelle valeur `media` pour téléverser l'audio des médias
-- (jingles/pubs/intros/outros/beds — table media_assets, cf. 0023_media_ads.sql).
ALTER TYPE "public"."upload_kind" ADD VALUE 'media';
