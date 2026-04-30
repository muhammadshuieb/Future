import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { tableExists } from "../db/table-exists.js";

/** One-line diagnostics after boot (DMA installs vary widely). */
export async function logDmaSchemaSnapshot(pool: Pool): Promise<void> {
  if (!config.dmaMode) return;
  try {
    let rmUsers = -1;
    if (await tableExists(pool, "rm_users")) {
      const [urows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM rm_users`);
      rmUsers = Number(urows[0]?.c ?? 0);
    }
    let radacctRows = -1;
    if (await tableExists(pool, "radacct")) {
      const [arows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM radacct`);
      radacctRows = Number(arows[0]?.c ?? 0);
    }
    const cum = await tableExists(pool, "rm_cumulate");
    const ct = await tableExists(pool, "rm_conntrack");
    console.log(
      `[dma] snapshot rm_users_rows=${rmUsers} radacct_rows=${radacctRows} rm_cumulate=${cum} rm_conntrack=${ct}`
    );
  } catch (e) {
    console.warn("[dma] snapshot failed", e);
  }
}
