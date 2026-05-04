/**
 * Creates helpful indexes on a restored Radius Manager (DMA) database.
 * sql/migrations/*.sql are skipped when rm_users exists — run this script after large imports.
 *
 *   cd api && npm run apply:dma-indexes
 */

import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { hasTable } from "../db/schemaGuards.js";

function isBenign(err: unknown): boolean {
  const e = err as { errno?: number; code?: string };
  const benign = new Set([1061, 1060, 1091]);
  if (e.errno !== undefined && benign.has(e.errno)) return true;
  return e.code === "ER_DUP_KEYNAME" || e.code === "ER_CANT_DROP_FIELD_OR_KEY";
}

async function tryIndex(p: Pool, sql: string, table: string): Promise<void> {
  if (!(await hasTable(p, table))) return;
  try {
    await p.query(sql);
  } catch (err) {
    if (!isBenign(err)) throw err;
  }
}

async function main() {
  const pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 4,
    namedPlaceholders: true,
  });

  const jobs: Array<[string, string]> = [
    ["radacct", "CREATE INDEX idx_fr_radacct_username_stop ON radacct (username, acctstoptime)"],
    ["radacct", "CREATE INDEX idx_fr_radacct_nas_session ON radacct (nasipaddress, acctsessionid)"],
    ["radacct", "CREATE INDEX idx_fr_radacct_start_time ON radacct (acctstarttime)"],
    ["radcheck", "CREATE INDEX idx_fr_radcheck_username_attr ON radcheck (username, attribute)"],
    ["radreply", "CREATE INDEX idx_fr_radreply_username_attr ON radreply (username, attribute)"],
    ["rm_users", "CREATE INDEX idx_fr_rm_users_srvid ON rm_users (srvid)"],
    ["rm_users", "CREATE INDEX idx_fr_rm_users_expiration ON rm_users (expiration)"],
    ["subscribers", "CREATE INDEX idx_fr_subscribers_username ON subscribers (username)"],
    ["subscribers", "CREATE INDEX idx_fr_subscribers_package ON subscribers (package_id)"],
    ["subscribers", "CREATE INDEX idx_fr_subscribers_expiration ON subscribers (expiration_date)"],
    ["invoices", "CREATE INDEX idx_fr_invoices_status_date ON invoices (status, created_at)"],
    ["invoices", "CREATE INDEX idx_fr_invoices_subscriber ON invoices (subscriber_id)"],
    ["payments", "CREATE INDEX idx_fr_payments_invoice_paid ON payments (invoice_id, paid_at)"],
  ];

  for (const [table, sql] of jobs) {
    await tryIndex(pool, sql, table);
  }

  console.log(JSON.stringify({ ok: true, applied: jobs.length }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
