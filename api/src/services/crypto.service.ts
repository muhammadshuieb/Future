import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function keyMaterial(): Buffer {
  const hex = config.aesSecretKeyHex;
  if (hex.length === 64) return Buffer.from(hex, "hex");
  return scryptSync(config.jwtSecret + ":nas-secret", "salt-fr", 32);
}

export function encryptSecret(plain: string): Buffer {
  const key = keyMaterial();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptSecret(buf: Buffer): string {
  const key = keyMaterial();
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
