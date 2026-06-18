/* Hachage de mots de passe (bcryptjs — pur JS, portable Alpine/Windows,
   pas de binding natif à compiler). Coût configurable via BCRYPT_COST. */

import bcrypt from "bcryptjs";
import { env } from "../env.js";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
