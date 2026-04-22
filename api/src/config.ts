import dotenv from "dotenv";
import { DMA_DATABASE_NAME } from "./dma/dmaSchemaContract.js";

dotenv.config();

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  if (u.protocol !== "mysql:") throw new Error("DATABASE_URL must be mysql://");
  const database = u.pathname.replace(/^\//, "");
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

const defaultDatabaseUrl = `mysql://root:rootpass@localhost:3306/${DMA_DATABASE_NAME}`;

export const config = {
  /** مطابق لـ radius.sql: `Database: radius` */
  databaseName: DMA_DATABASE_NAME,
  databaseUrl: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  aesSecretKeyHex: process.env.AES_SECRET_KEY ?? "",
  defaultTenantId:
    process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001",
  coaTimeoutMs: parseInt(process.env.COA_TIMEOUT_MS ?? "3000", 10),
  quotaThrottleRate: process.env.QUOTA_THROTTLE_RATE ?? "1M/1M",
  port: parseInt(process.env.PORT ?? "3000", 10),
  eventsChannel: process.env.EVENTS_CHANNEL ?? "fr:events",
  db: (() => {
    const parsed = parseDatabaseUrl(process.env.DATABASE_URL ?? defaultDatabaseUrl);
    if (parsed.database !== DMA_DATABASE_NAME) {
      throw new Error(
        `DATABASE_URL must use database name "${DMA_DATABASE_NAME}" (same as radius.sql). Got "${parsed.database}". Example: mysql://USER:PASS@HOST:3306/${DMA_DATABASE_NAME}`
      );
    }
    return parsed;
  })(),
};
