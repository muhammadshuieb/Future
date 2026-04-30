import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hasTable } from "../db/schemaGuards.js";
import { config } from "../config.js";

type CheckResult = {
  name: string;
  pass: boolean;
  detail: string;
};

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  const checks: CheckResult[] = [];
  if (!(await hasTable(pool, "rm_users"))) {
    throw new Error("rm_users table missing");
  }
  if (!(await hasTable(pool, "radcheck"))) {
    throw new Error("radcheck table missing");
  }
  if (!(await hasTable(pool, "rm_services"))) {
    throw new Error("rm_services table missing");
  }

  const enabledExpired = await scalar(
    `SELECT COUNT(*) AS c
     FROM rm_users
     WHERE COALESCE(enableuser, 0) = 1
       AND expiration IS NOT NULL
       AND expiration < NOW()`
  );
  checks.push({
    name: "expired_users_disabled",
    pass: enabledExpired === 0,
    detail: `enabled_expired_count=${enabledExpired}`,
  });

  const expiredWithCleartext = await scalar(
    `SELECT COUNT(*) AS c
     FROM radcheck rc
     JOIN rm_users u ON u.username = rc.username
     WHERE u.expiration IS NOT NULL
       AND u.expiration < NOW()
       AND rc.attribute = 'Cleartext-Password'`
  );
  checks.push({
    name: "expired_users_no_cleartext_password",
    pass: expiredWithCleartext === 0,
    detail: `expired_cleartext_count=${expiredWithCleartext}`,
  });

  let quotaStateRows = -1;
  if (await hasTable(pool, "user_quota_state")) {
    quotaStateRows = await scalar(
      `SELECT COUNT(*) AS c
       FROM user_quota_state
       WHERE tenant_id = ?
         AND quota_date = CURDATE()`,
      [config.defaultTenantId]
    );
  }
  checks.push({
    name: "quota_state_table_present",
    pass: quotaStateRows >= 0,
    detail: quotaStateRows >= 0 ? `today_rows=${quotaStateRows}` : "table_missing",
  });

  const failed = checks.filter((c) => !c.pass);
  console.log(
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        database: config.databaseName,
        tenant_id: config.defaultTenantId,
        pass: failed.length === 0,
        checks,
      },
      null,
      2
    )
  );
  await pool.end();
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

