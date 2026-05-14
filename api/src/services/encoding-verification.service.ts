import type { Pool, RowDataPacket } from "mysql2/promise";

type RedisLike = {
  set(key: string, value: string, mode: string, ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
};

export type CharsetColumnReport = {
  table: string;
  column: string;
  dataType: string;
  charset: string | null;
  collation: string | null;
};

export type CharsetVerificationReport = {
  database: string;
  connectionSession: Record<string, string>;
  tablesNonUtf8mb4: Array<{ table: string; tableCollation: string | null; charset: string | null }>;
  columnsNonUtf8mb4: CharsetColumnReport[];
  warnings: string[];
  checkedAt: string;
};

function isUtf8mb4Collation(collation: string | null): boolean {
  if (!collation) return false;
  const c = collation.toLowerCase();
  return c.startsWith("utf8mb4_");
}

function isUtf8mb4Charset(charset: string | null): boolean {
  if (!charset) return false;
  return charset.toLowerCase() === "utf8mb4";
}

/**
 * Read-only checks against information_schema + session variables.
 * Logs should be emitted by the caller (startup) — this returns structured data only.
 */
export async function buildCharsetVerificationReport(pool: Pool): Promise<CharsetVerificationReport> {
  const warnings: string[] = [];
  const [dbRow] = await pool.query<RowDataPacket[]>(`SELECT DATABASE() AS d`);
  const database = String(dbRow[0]?.d ?? "");

  const [sessRows] = await pool.query<RowDataPacket[]>(
    `SHOW SESSION VARIABLES WHERE Variable_name IN (
      'character_set_client','character_set_connection','character_set_results','collation_connection'
    )`
  );
  const connectionSession: Record<string, string> = {};
  for (const r of sessRows) {
    connectionSession[String(r.Variable_name)] = String(r.Value ?? "");
  }
  for (const [k, v] of Object.entries(connectionSession)) {
    if (k.startsWith("character_set") && v.toLowerCase() !== "utf8mb4") {
      warnings.push(`session ${k}=${v} (expected utf8mb4)`);
    }
    if (k === "collation_connection" && !isUtf8mb4Collation(v)) {
      warnings.push(`session collation_connection=${v} (expected utf8mb4_*)`);
    }
  }

  const [tblRows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, TABLE_COLLATION AS tc
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [database]
  );

  const tablesNonUtf8mb4: CharsetVerificationReport["tablesNonUtf8mb4"] = [];
  for (const r of tblRows) {
    const tc = r.tc != null ? String(r.tc) : null;
    if (!isUtf8mb4Collation(tc)) {
      tablesNonUtf8mb4.push({
        table: String(r.t),
        tableCollation: tc,
        charset: tc ? tc.split("_")[0] ?? null : null,
      });
      warnings.push(`table ${String(r.t)} collation=${tc}`);
    }
  }

  const [colRows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d, CHARACTER_SET_NAME AS ch, COLLATION_NAME AS col
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND CHARACTER_SET_NAME IS NOT NULL`,
    [database]
  );

  const columnsNonUtf8mb4: CharsetColumnReport[] = [];
  for (const r of colRows) {
    const ch = r.ch != null ? String(r.ch) : null;
    const col = r.col != null ? String(r.col) : null;
    if (!isUtf8mb4Charset(ch) || !isUtf8mb4Collation(col)) {
      columnsNonUtf8mb4.push({
        table: String(r.t),
        column: String(r.c),
        dataType: String(r.d),
        charset: ch,
        collation: col,
      });
    }
  }

  if (columnsNonUtf8mb4.length > 200) {
    warnings.push(`many columns (${columnsNonUtf8mb4.length}) are not utf8mb4 — listing truncated in API`);
  }

  return {
    database,
    connectionSession,
    tablesNonUtf8mb4,
    columnsNonUtf8mb4,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

export async function verifyRedisUtf8Roundtrip(redis: RedisLike | null): Promise<{
  ok: boolean;
  detail?: string;
}> {
  if (!redis) return { ok: true, detail: "redis_not_configured" };
  const key = `fr:encoding_probe:${Date.now()}`;
  const sample = "مرحبا Redis — UTF-8 probe";
  try {
    await redis.set(key, sample, "EX", 30);
    const back = await redis.get(key);
    await redis.del(key);
    if (back !== sample) return { ok: false, detail: "roundtrip_mismatch" };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Best-effort: WAHA URL configured (full send test belongs in integration). */
export function verifyWhatsAppUtf8Configured(): { ok: boolean; wahaUrl: string | null; note: string } {
  const wahaUrl = (process.env.WAHA_URL ?? process.env.WAHA_INTERNAL_URL ?? "").trim() || null;
  return {
    ok: true,
    wahaUrl,
    note: "Outgoing WAHA JSON must use UTF-8; verify message bodies in whatsapp_messages after send.",
  };
}
