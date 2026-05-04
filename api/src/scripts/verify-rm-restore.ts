/**
 * يقارن بين قاعدة مستعادة من Radius Manager وما يقرأه المشروع (جداول DMA + امتداد subscribers).
 * التشغيل: من مجلد api مع DATABASE_URL و DEFAULT_TENANT_ID
 *   npm run verify:rm-restore
 */

import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";
import { validateDmaDatabase } from "../dma/validateDmaDatabase.js";
import type { RowDataPacket } from "mysql2";

type Diff = { area: string; detail: string };
type Hint = { area: string; detail: string };

async function countWhen(pool: import("mysql2/promise").Pool, table: string): Promise<number | null> {
  if (!(await hasTable(pool, table))) return null;
  const [r] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(r[0]?.c ?? 0);
}

async function main() {
  const tenantId = config.defaultTenantId;
  const diffs: Diff[] = [];
  const hints: Hint[] = [];

  const v = await validateDmaDatabase(pool);
  if (!v.ok) {
    diffs.push({
      area: "dma_schema",
      detail: `validateDmaDatabase failed: missingTables=${JSON.stringify(v.missingTables)} columnMismatches=${JSON.stringify(
        v.columnMismatches
      )} databaseNameMatches=${v.databaseNameMatches}`,
    });
  }

  const [dbNameRows] = await pool.query<RowDataPacket[]>(`SELECT DATABASE() AS db`);
  const sessionDatabase = String(dbNameRows[0]?.db ?? "");

  const rmUsers = await countWhen(pool, "rm_users");
  const radcheck = await countWhen(pool, "radcheck");
  const radacct = await countWhen(pool, "radacct");
  const rmMgr = await countWhen(pool, "rm_managers");
  const rmSrv = await countWhen(pool, "rm_services");
  const subs = await countWhen(pool, "subscribers");
  const packages = await countWhen(pool, "packages");

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
    if (rmCount > 0 && subsForTenant > 0 && rmCount > subsForTenant * 1.2) {
      hints.push({
        area: "rm_users_vs_subscribers_scale",
        detail: `rm_users (non-empty)=${rmCount} is much larger than subscribers for tenant=${subsForTenant}; consider import:dma or subscriber sync if hybrid mode is intended`,
      });
    }
  }

  let staffRmBridge = 0;
  if (await hasTable(pool, "staff_users")) {
    const staffCols = await getTableColumns(pool, "staff_users");
    if (staffCols.has("rm_managername")) {
      const [c] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM staff_users WHERE rm_managername IS NOT NULL AND TRIM(rm_managername) <> ''`
      );
      staffRmBridge = Number(c[0]?.c ?? 0);
    } else {
      const [c] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM staff_users WHERE id LIKE 'rm:%'`
      );
      staffRmBridge = Number(c[0]?.c ?? 0);
    }
    const rmMgrCount = rmMgr ?? 0;
    if (rmMgrCount > 0 && staffRmBridge === 0) {
      hints.push({
        area: "rm_managers_staff_bridge",
        detail: `rm_managers count=${rmMgrCount} but no staff_users rows linked yet (rm:* id or rm_managername); log in once to sync`,
      });
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    database: config.databaseName,
    session_database: sessionDatabase,
    dma_validation: v,
    counts: {
      rm_users: rmUsers,
      radcheck: radcheck,
      radacct: radacct,
      rm_managers: rmMgr,
      rm_services: rmSrv,
      packages,
      subscribers_total: subs,
      subscribers_tenant: subsForTenant,
      subscribers_username_overlap_with_rm_users: subscribersLinkedToRm,
      staff_users_rm_manager_bridge: staffRmBridge,
    },
    diffs,
    hints,
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
