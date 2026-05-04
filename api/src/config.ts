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

/**
 * If set, schema validation (DMA) requires `SELECT DATABASE()` to equal this name.
 * Leave unset to accept any database name the connection uses (e.g. restored under a custom name).
 */
const expectedRmSchemaName = process.env.RM_DATABASE_NAME?.trim() ?? "";

const nodeEnv = process.env.NODE_ENV ?? "development";
const rawJwt = process.env.JWT_SECRET?.trim();

if (nodeEnv === "production") {
  if (!rawJwt || rawJwt === "dev-secret-change-me") {
    throw new Error(
      "JWT_SECRET must be set to a strong non-default value when NODE_ENV=production"
    );
  }
}

function parseCorsOrigins(nodeEnv: string): string[] | "all" {
  const raw = (process.env.CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS)?.trim();
  if (!raw || raw === "*") {
    if (nodeEnv === "production") {
      throw new Error("CORS_ORIGINS (or ALLOWED_ORIGINS) must be explicitly set when NODE_ENV=production");
    }
    return "all";
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const parsedUrl = parseDatabaseUrl(process.env.DATABASE_URL ?? defaultDatabaseUrl);

const dmaModeRaw = String(process.env.DMA_MODE ?? "")
  .trim()
  .toLowerCase();
const dmaMode = dmaModeRaw === "1" || dmaModeRaw === "true" || dmaModeRaw === "yes";

function parsePoolInt(name: string, fallback: number, allowZero = false): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (allowZero && n === 0) return 0;
  return n > 0 ? n : fallback;
}

const coaFallbackRaw = String(process.env.COA_MIKROTIK_FALLBACK ?? "1").trim().toLowerCase();
const coaMikrotikFallback = !(coaFallbackRaw === "0" || coaFallbackRaw === "false" || coaFallbackRaw === "no");

export const config = {
  /**
   * Pure Radius Manager (DMA) mode: no sql/migrations, no usage sync into parallel tables,
   * restore is raw SQL import only. Portal and dashboard read rm_*, rad*, and nas tables directly.
   */
  dmaMode,
  nodeEnv,
  /** Current schema from DATABASE_URL (actual connection). */
  databaseName: parsedUrl.database,
  /**
   * Optional: when non-empty, `validateDmaDatabase` requires the session DB to match.
   * Example: `RM_DATABASE_NAME=radius` after restoring `radius.sql` into database `radius`.
   */
  expectedRmSchemaName,
  databaseUrl: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: rawJwt ?? "dev-secret-change-me",
  /** Staff JWT lifetime, e.g. `12h`, `7d` (see `jsonwebtoken` expiresIn). */
  jwtExpiresIn: (process.env.JWT_EXPIRES_IN ?? "12h").trim() || "12h",
  aesSecretKeyHex: process.env.AES_SECRET_KEY ?? "",
  defaultTenantId:
    process.env.DEFAULT_TENANT_ID ?? "00000000-0000-0000-0000-000000000001",
  coaTimeoutMs: parseInt(process.env.COA_TIMEOUT_MS ?? "3000", 10),
  coaRetryCount: Math.max(1, parseInt(process.env.COA_RETRY_COUNT ?? "3", 10)),
  /** Delay between UDP CoA attempts (packet loss). Production often uses 1500–2000 ms. */
  coaRetryDelayMs: Math.max(0, parseInt(process.env.COA_RETRY_DELAY_MS ?? "400", 10)),
  /** After CoA Disconnect-Request fails (all UDP retries), try MikroTik REST kick when credentials exist. */
  coaMikrotikFallback,
  quotaThrottleRate: process.env.QUOTA_THROTTLE_RATE ?? "1M/1M",
  port: parseInt(process.env.PORT ?? "3000", 10),
  eventsChannel: process.env.EVENTS_CHANNEL ?? "fr:events",
  /** Comma-separated origins, or omit / * for permissive dev (still tighten in prod via CORS_ORIGINS) */
  corsOrigins: parseCorsOrigins(nodeEnv),
  db: parsedUrl,
  /** mysql2 pool `connectionLimit` (raise under load; cap below MySQL max_connections). */
  dbPoolConnectionLimit: parsePoolInt("MYSQL_POOL_CONNECTION_LIMIT", 10),
  /** mysql2 pool `queueLimit` (0 = unlimited waiters). */
  dbPoolQueueLimit: parsePoolInt("MYSQL_POOL_QUEUE_LIMIT", 0, true),
  /**
   * Public URL of this API (scheme + host + optional port). Used for Google OAuth redirect_uri.
   * Example: https://panel.example.com or http://localhost:3000
   */
  publicAppUrl: (process.env.PUBLIC_APP_URL ?? "").trim() || `http://localhost:${parseInt(process.env.PORT ?? "3000", 10)}`,
  /** Where the browser returns after Google OAuth (Vite dev server or production panel). */
  publicFrontendUrl: (process.env.PUBLIC_FRONTEND_URL ?? "").trim() || "http://localhost:5173",
  /** Web OAuth client for “Connect Google Drive” backup upload (Google Cloud Console). */
  googleBackupOAuth: {
    clientId: (process.env.GOOGLE_BACKUP_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_BACKUP_CLIENT_SECRET ?? "").trim(),
  },
  /** IANA timezone for scheduled backups (worker + UI display). */
  appTimezone: (process.env.APP_TIMEZONE ?? "Asia/Damascus").trim() || "Asia/Damascus",
};
