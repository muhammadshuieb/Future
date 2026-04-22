import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import {
  CONTRACT_VERSION,
  DMA_DATABASE_NAME,
  DMA_MINIMUM_COLUMNS,
  DMA_REFERENCE_DUMP_TABLES,
} from "./dmaSchemaContract.js";

export type DmaValidationResult = {
  ok: boolean;
  contractVersion: string;
  expectedDatabaseName: typeof DMA_DATABASE_NAME;
  actualDatabaseName: string | null;
  databaseNameMatches: boolean;
  missingTables: string[];
  columnMismatches: { table: string; missingColumns: string[] }[];
};

export async function validateDmaDatabase(pool: Pool): Promise<DmaValidationResult> {
  const [dbRows] = await pool.query<RowDataPacket[]>(`SELECT DATABASE() AS d`);
  const schema = dbRows[0]?.d as string | null;
  const databaseNameMatches = schema === DMA_DATABASE_NAME;
  if (!schema) {
    return {
      ok: false,
      contractVersion: CONTRACT_VERSION,
      expectedDatabaseName: DMA_DATABASE_NAME,
      actualDatabaseName: null,
      databaseNameMatches: false,
      missingTables: ["(no database selected)"],
      columnMismatches: [],
    };
  }
  if (!databaseNameMatches) {
    return {
      ok: false,
      contractVersion: CONTRACT_VERSION,
      expectedDatabaseName: DMA_DATABASE_NAME,
      actualDatabaseName: schema,
      databaseNameMatches: false,
      missingTables: [],
      columnMismatches: [],
    };
  }

  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [schema]
  );
  const have = new Set(tables.map((r) => r.t as string));
  const missingTables = DMA_REFERENCE_DUMP_TABLES.filter((t) => !have.has(t));

  const columnMismatches: { table: string; missingColumns: string[] }[] = [];
  for (const [table, required] of Object.entries(DMA_MINIMUM_COLUMNS)) {
    if (!have.has(table)) {
      columnMismatches.push({ table, missingColumns: [...required] });
      continue;
    }
    const [cols] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [schema, table]
    );
    const ch = new Set(cols.map((r) => r.c as string));
    const missingColumns = required.filter((c) => !ch.has(c));
    if (missingColumns.length)
      columnMismatches.push({ table, missingColumns });
  }

  return {
    ok:
      databaseNameMatches &&
      missingTables.length === 0 &&
      columnMismatches.every((m) => m.missingColumns.length === 0),
    contractVersion: CONTRACT_VERSION,
    expectedDatabaseName: DMA_DATABASE_NAME,
    actualDatabaseName: schema,
    databaseNameMatches,
    missingTables,
    columnMismatches,
  };
}
