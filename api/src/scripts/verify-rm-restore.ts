/**
 * يقارن بين قاعدة مستعادة من Radius Manager وما يقرأه المشروع (جداول DMA + امتداد subscribers).
 * التشغيل: من مجلد api مع DATABASE_URL و DEFAULT_TENANT_ID
 *   npm run verify:rm-restore
 */

import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { hasTable } from "../db/schemaGuards.js";
import { validateDmaDatabase } from "../dma/validateDmaDatabase.js";
import type { RowDataPacket } from "mysql2";

type Diff = { area: string; detail: string };

async function countWhen(pool: import("mysql2/promise").Pool, table: string): Promise<number | null> {
  if (!(await hasTable(pool, table))) return null;
  const [r] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(r[0]?.c ?? 0);
}

async function main() {
  const tenantId = config.defaultTenantId;
  const diffs: Diff[] = [];

  const v = await validateDmaDatabase(pool);
  if (!v.ok) {
    diffs.push({
      area: "dma_schema",
      detail: `validateDmaDatabase failed: missingTables=${JSON.stringify(v.missingTables)} columnMismatches=${JSON.stringify(
        v.columnMismatches
      )} databaseNameMatches=${v.databaseNameMatches}`,
    });
  }

  const rmUsers = await countWhen(pool, "rm_users");
  const radcheck = await countWhen(pool, "radcheck");
  const radacct = await countWhen(pool, "radacct");
  const rmMgr = await countWhen(pool, "rm_managers");
  const rmSrv = await countWhen(pool, "rm_services");
  const subs = await countWhen(pool, "subscribers");

  let subsForTenant = 0;
  if (await hasTable(pool, "subscribers")) {
    const [r] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM subscribers WHERE tenant_id = ?`,
      [tenantId]
    );
    subsForTenant = Number(r[0]?.c ?? 0);
  }

  let subscribersLinkedToRm = 0;
  if ((await hasTable(pool, "rm_users")) && (await hasTable(pool, "subscribers"))) {
    const [overlap] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c
       FROM rm_users r
       INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
       WHERE TRIM(r.username) <> ''`,
      [tenantId]
    );
    subscribersLinkedToRm = Number(overlap[0]?.c ?? 0);
    const [rmNonEmpty] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM rm_users WHERE TRIM(username) <> ''`
    );
    const rmCount = Number(rmNonEmpty[0]?.c ?? 0);
    if (rmCount > 0 && subscribersLinkedToRm < rmCount && process.env.RM_VERIFY_STRICT_SYNC === "1") {
      diffs.push({
        area: "subscribers_vs_rm_users",
        detail: `rm_users (non-empty username)=${rmCount}, subscribers with same username=${subscribersLinkedToRm} (set RM_VERIFY_STRICT_SYNC=0 to treat as warning only)`,
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    database: config.databaseName,
    dma_validation: v,
    counts: {
      rm_users: rmUsers,
      radcheck: radcheck,
      radacct: radacct,
      rm_managers: rmMgr,
      rm_services: rmSrv,
      subscribers_total: subs,
      subscribers_tenant: subsForTenant,
      subscribers_username_overlap_with_rm_users: subscribersLinkedToRm,
    },
    diffs,
    pass: diffs.length === 0 && v.ok,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) {
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
