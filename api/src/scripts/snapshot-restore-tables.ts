import { promises as fs } from "fs";
import { join } from "path";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { hasTable } from "../db/schemaGuards.js";

type TableColumn = {
  field: string;
  type: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
};

type TableSnapshot = {
  table: string;
  exists: boolean;
  row_count: number | null;
  columns: TableColumn[];
};

const TARGET_TABLES = [
  "nas",
  "rm_allowedmanagers",
  "rm_allowednases",
  "rm_cards",
  "rm_changesrv",
  "rm_managers",
  "rm_services",
  "rm_usergroups",
  "rm_users",
] as const;

async function readTableSnapshot(table: string): Promise<TableSnapshot> {
  const exists = await hasTable(pool, table);
  if (!exists) {
    return { table, exists: false, row_count: null, columns: [] };
  }

  const [countRows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM \`${table}\``);
  const rowCount = Number(countRows[0]?.c ?? 0);

  const [columnsRows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
  const columns: TableColumn[] = columnsRows.map((r) => ({
    field: String(r.Field ?? ""),
    type: String(r.Type ?? ""),
    nullable: String(r.Null ?? "").toUpperCase() === "YES",
    key: String(r.Key ?? ""),
    defaultValue: r.Default == null ? null : String(r.Default),
    extra: String(r.Extra ?? ""),
  }));

  return {
    table,
    exists: true,
    row_count: rowCount,
    columns,
  };
}

async function main() {
  const startedAt = new Date();
  const snapshots: TableSnapshot[] = [];

  for (const table of TARGET_TABLES) {
    snapshots.push(await readTableSnapshot(table));
  }

  const payload = {
    generated_at: startedAt.toISOString(),
    db_name: config.databaseName,
    target_tables: TARGET_TABLES,
    tables: snapshots,
  };

  const dir = join(process.cwd(), "backups", "pre-restore-snapshots");
  await fs.mkdir(dir, { recursive: true });
  const safeTs = startedAt.toISOString().replace(/[:.]/g, "-");
  const filePath = join(dir, `snapshot-${safeTs}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: filePath,
        db_name: config.databaseName,
        tables_checked: TARGET_TABLES.length,
      },
      null,
      2
    )
  );

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
