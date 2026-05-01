import { promises as fs } from "fs";
import { resolve } from "path";

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

type SnapshotPayload = {
  generated_at: string;
  db_name: string;
  tables: TableSnapshot[];
};

function toColumnSignature(c: TableColumn): string {
  return `${c.field}|${c.type}|${c.nullable}|${c.key}|${c.defaultValue ?? "null"}|${c.extra}`;
}

async function readSnapshot(pathArg: string): Promise<SnapshotPayload> {
  const filePath = resolve(pathArg);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as SnapshotPayload;
}

async function main() {
  const beforeArg = process.argv[2];
  const afterArg = process.argv[3];
  if (!beforeArg || !afterArg) {
    console.error("Usage: tsx src/scripts/compare-restore-snapshots.ts <before.json> <after.json>");
    process.exit(2);
    return;
  }

  const before = await readSnapshot(beforeArg);
  const after = await readSnapshot(afterArg);

  const beforeByTable = new Map(before.tables.map((t) => [t.table, t]));
  const afterByTable = new Map(after.tables.map((t) => [t.table, t]));
  const allTables = [...new Set([...beforeByTable.keys(), ...afterByTable.keys()])].sort();

  const tableDiffs = allTables.map((table) => {
    const b = beforeByTable.get(table);
    const a = afterByTable.get(table);
    if (!b || !a) {
      return {
        table,
        issue: "table_missing_in_one_snapshot",
      };
    }

    const beforeCols = new Set(b.columns.map(toColumnSignature));
    const afterCols = new Set(a.columns.map(toColumnSignature));
    const removedColumns = b.columns.filter((c) => !afterCols.has(toColumnSignature(c))).map((c) => c.field);
    const addedColumns = a.columns.filter((c) => !beforeCols.has(toColumnSignature(c))).map((c) => c.field);

    return {
      table,
      before_exists: b.exists,
      after_exists: a.exists,
      before_rows: b.row_count,
      after_rows: a.row_count,
      row_delta:
        b.row_count == null || a.row_count == null
          ? null
          : Number(a.row_count) - Number(b.row_count),
      removed_columns: removedColumns,
      added_columns: addedColumns,
    };
  });

  const hasRisk = tableDiffs.some((d) => {
    if ("issue" in d) return true;
    if (d.before_exists && !d.after_exists) return true;
    if (d.removed_columns.length > 0) return true;
    return false;
  });

  const report = {
    compared_at: new Date().toISOString(),
    before: { generated_at: before.generated_at, db_name: before.db_name },
    after: { generated_at: after.generated_at, db_name: after.db_name },
    high_risk_detected: hasRisk,
    table_diffs: tableDiffs,
  };

  console.log(JSON.stringify(report, null, 2));
  if (hasRisk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
