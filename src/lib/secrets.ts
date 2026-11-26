import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Cifrado de secretos en reposo: AES-256-GCM. La llave sale de APP_ENCRYPTION_KEY (variable de entorno,
// ≥ 32 caracteres aleatorios) con HKDF-SHA256; nunca se guarda en la base de datos. Cada valor lleva su IV
// y se asocia a su nombre (AAD), así que no se puede copiar el cifrado de un ajuste a otro.
//
// Formato: v1.<iv>.<tag>.<cifrado>  (base64url)

const VERSION = "v1";

function deriveKey(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", raw, "team-tracker", "settings-encryption-v1", 32));
}

export const encryptionAvailable = (): boolean => deriveKey() !== null;

export function encryptSecret(plain: string, aad: string): string {
  const key = deriveKey();
  if (!key) throw new Error("APP_ENCRYPTION_KEY no está configurada (mínimo 32 caracteres).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

/** Lanza si el valor está alterado, es de otro ajuste o la llave cambió. */
export function decryptSecret(token: string, aad: string): string {
  const key = deriveKey();
  if (!key) throw new Error("APP_ENCRYPTION_KEY no está configurada.");
  const [v, iv, tag, data] = token.split(".");
  if (v !== VERSION || !iv || !tag || !data) throw new Error("Formato de secreto desconocido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** "•••• 1a2b": solo los últimos 4 caracteres (o nada si el valor es corto). */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `•••• ${value.slice(-4)}` : "••••";
}
