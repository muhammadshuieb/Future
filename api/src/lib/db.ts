import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";

export type DbRow = RowDataPacket;

/**
 * Shared MySQL pool (connection reuse). Single source for mysql2/promise.
 */
export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

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
