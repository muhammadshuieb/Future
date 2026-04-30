import { createHash } from "crypto";
import { createRequire as createNodeRequire } from "node:module";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { hasTable } from "../db/schemaGuards.js";

const nodeRequire = createNodeRequire(import.meta.url);

type Md4Chain = {
  update(data: Buffer | string): Md4Chain;
  digest(enc: "hex"): string;
};

type Md4Factory = () => Md4Chain;

function loadMd4Factory(): Md4Factory | null {
  try {
    return nodeRequire("hash.js/lib/hash/md4") as Md4Factory;
  } catch {
    return null;
  }
}

const md4Factory = loadMd4Factory();

function md5Hex(plain: string): string {
  return createHash("md5").update(plain, "utf8").digest("hex").toLowerCase();
}

function ntHashHex(plain: string): string | null {
  if (!md4Factory) return null;
  try {
    return md4Factory()
      .update(Buffer.from(plain, "utf16le"))
      .digest("hex")
      .toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHex(s: string): string {
  return s.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

const PASSWORD_ATTRS = [
  "Cleartext-Password",
  "MD5-Password",
  "User-Password",
  "NT-Password",
] as const;

function matchesRadcheckValue(attrNorm: string, storedRaw: string, password: string): boolean {
  const stored = String(storedRaw ?? "").trim();
  if (!stored) return false;
  if (attrNorm === "cleartext-password") return stored === password;
  if (attrNorm === "user-password") {
    if (stored === password) return true;
    const hx = normalizeHex(stored);
    if (hx.length === 32 && hx === md5Hex(password)) return true;
    return false;
  }
  if (attrNorm === "md5-password") {
    const hx = normalizeHex(stored);
    if (hx.length === 32 && hx === md5Hex(password)) return true;
    return false;
  }
  if (attrNorm === "nt-password") {
    const hx = normalizeHex(stored);
    if (hx.length !== 32) return false;
    const nt = ntHashHex(password);
    return nt != null && nt === hx;
  }
  return false;
}

/**
 * Portal / subscriber auth: prefer radcheck (Cleartext / MD5 / User / NT), then rm_users legacy MD5 hex.
 */
export async function verifyLegacySubscriberPassword(
  pool: Pool,
  username: string,
  password: string
): Promise<boolean> {
  if (await hasTable(pool, "radcheck")) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT attribute, value FROM radcheck
       WHERE username = ?
         AND UPPER(TRIM(attribute)) IN (${PASSWORD_ATTRS.map(() => "?").join(",")})`,
      [username, ...PASSWORD_ATTRS.map((a) => a.toUpperCase())]
    );
    for (const r of rows as RowDataPacket[]) {
      const attr = String(r.attribute ?? "").trim().toLowerCase();
      if (matchesRadcheckValue(attr, String(r.value ?? ""), password)) return true;
    }
  }
  if (await hasTable(pool, "rm_users")) {
    const [rmRows] = await pool.query<RowDataPacket[]>(
      `SELECT password FROM rm_users WHERE username = ? LIMIT 1`,
      [username]
    );
    const p = rmRows[0]?.password != null ? String(rmRows[0].password).trim() : "";
    if (p.length === 32 && /^[0-9a-fA-F]+$/.test(p) && md5Hex(password) === p.toLowerCase()) {
      return true;
    }
  }
  return false;
}
