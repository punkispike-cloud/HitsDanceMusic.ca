/* Wrapper S3 minimal (compte AWS existant). Upload pré-signé direct :
   l'API n'est jamais sur le chemin des octets — elle ne fait que signer
   l'URL PUT et vérifier l'objet ensuite (HEAD). */

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isS3Configured } from "../env.js";

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    // R2 (et tout endpoint S3 personnalisé) : on passe endpoint + forcePathStyle
    // uniquement quand S3_ENDPOINT est posé. Sinon, comportement AWS inchangé.
    const endpoint = env.S3_ENDPOINT || undefined;
    _client = new S3Client({
      region: env.S3_REGION || "auto",
      endpoint,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/** URL PUT pré-signée (expire en 15 min). */
export async function presignPut(
  objectKey: string,
  contentType: string,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(client(), cmd, { expiresIn: 900 });
}

/** Récupère taille/type réels d'un objet (vérification post-upload). */
export async function headObject(
  objectKey: string,
): Promise<{ size: number; contentType: string } | null> {
  try {
    const r = await client().send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }),
    );
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? "" };
  } catch {
    return null;
  }
}

/** URL publique finale (via CDN/domaine custom). */
export function publicUrl(objectKey: string): string {
  const base = env.S3_PUBLIC_BASE_URL.replace(/\/+$/, "");
  return `${base}/${objectKey}`;
}

export { isS3Configured };
