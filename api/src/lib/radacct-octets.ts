import type { Pool } from "mysql2/promise";
import { hasColumn } from "../db/schemaGuards.js";

/** Bytes expression for one radacct row (handles gigaword columns when present). */
export async function radacctSessionOctetsExpr(pool: Pool): Promise<string> {
  const gIn = await hasColumn(pool, "radacct", "acctinputgigawords");
  const gOut = await hasColumn(pool, "radacct", "acctoutputgigawords");
  if (gIn && gOut) {
    return `(COALESCE(acctinputoctets,0) + COALESCE(acctinputgigawords,0) * 4294967296) + (COALESCE(acctoutputoctets,0) + COALESCE(acctoutputgigawords,0) * 4294967296)`;
  }
  return `COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)`;
}
