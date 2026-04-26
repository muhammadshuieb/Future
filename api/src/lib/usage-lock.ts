import { randomUUID } from "crypto";
import { config } from "../config.js";

/**
 * الحد الأدنى من واجهة Redis المستخدمة هنا (يتجنب TS2344/TS2709 مع أنواع التصدير الافتراضي لـ ioredis).
 */
export type UsageCycleRedisClient = {
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number,
    mode: "NX"
  ): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
};

const LOCK_PREFIX = "fr:usage-cycle:";
const TTL_SEC = 120;

/**
 * Single-flight lock so only one process runs the usage / quota cycle per tenant.
 */
export async function withUsageCycleLock<T>(
  redis: UsageCycleRedisClient,
  fn: () => Promise<T>
): Promise<{ ran: true; result: T } | { ran: false; reason: "locked" }> {
  const key = `${LOCK_PREFIX}${config.defaultTenantId}`;
  const token = randomUUID();
  const ok = await redis.set(key, token, "EX", TTL_SEC, "NX");
  if (ok !== "OK") {
    return { ran: false, reason: "locked" };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    const cur = await redis.get(key);
    if (cur === token) {
      await redis.del(key);
    }
  }
}
