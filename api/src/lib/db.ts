import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { assertDmaSqlSafe } from "../dma/dma-sql-guard.js";

export type DbRow = RowDataPacket;

function guardSqlArg(first: unknown): void {
  if (typeof first === "string") {
    assertDmaSqlSafe(first);
    return;
  }
  if (first && typeof first === "object" && "sql" in first) {
    assertDmaSqlSafe(String((first as { sql: unknown }).sql));
  }
}

/**
 * Shared MySQL pool (connection reuse). Single source for mysql2/promise.
 * When DMA_MODE is on, query/execute are guarded against hybrid tables (subscribers, packages, nas_servers).
 */
const rawPool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: config.dbPoolConnectionLimit,
  queueLimit: config.dbPoolQueueLimit,
  namedPlaceholders: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

const origQuery = rawPool.query.bind(rawPool);
(rawPool as Pool).query = ((sql: unknown, ...rest: unknown[]) => {
  guardSqlArg(sql);
  return (origQuery as (a: unknown, ...r: unknown[]) => unknown)(sql, ...rest);
}) as Pool["query"];

const origExecute = rawPool.execute.bind(rawPool);
(rawPool as Pool).execute = ((sql: unknown, ...rest: unknown[]) => {
  guardSqlArg(sql);
  return (origExecute as (a: unknown, ...r: unknown[]) => unknown)(sql, ...rest);
}) as Pool["execute"];

export const pool = rawPool;

// mysql2 Pool typings omit EventEmitter "error"; runtime still emits on connection loss.
(pool as import("node:events").EventEmitter).on("error", (err: unknown) => {
  console.error("[db] pool error", err);
});

/**
 * Wait until at least one connection succeeds (Docker / slow MySQL startup).
 */
export async function waitForDbReady(maxAttempts = 60, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      if (attempt > 1) {
        console.log(`[db] ready after ${attempt} attempts`);
      }
      return;
    } catch (e) {
      console.error(`[db] connect attempt ${attempt}/${maxAttempts} failed`, e);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("[db] exhausted retries; MySQL unavailable");
}
