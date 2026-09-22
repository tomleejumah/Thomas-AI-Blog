import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function keyBytes() {
  const raw =
    process.env.SITE_SECRETS_KEY ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "";
  if (!raw) {
    throw new Error("SITE_SECRETS_KEY (or ADMIN_SESSION_SECRET) required to encrypt site secrets");
  }
  return createHash("sha256").update(raw).digest(); // 32 bytes
}

/** Encrypt WP app password for DB storage */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

/** Decrypt DB value; plain legacy values pass through */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt site credentials — ADMIN_SESSION_SECRET or ADMIN_PASSWORD has changed. " +
        "Re-save the site's WP App Password in Settings to re-encrypt it with the current key."
    );
  }
}

export function isEncryptedSecret(stored: string) {
  return stored.startsWith(PREFIX);
}
