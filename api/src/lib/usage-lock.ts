import { randomUUID } from "crypto";
import type Redis from "ioredis";
import { config } from "../config.js";

const LOCK_PREFIX = "fr:usage-cycle:";
const TTL_SEC = 120;

/**
 * Single-flight lock so only one process runs the usage / quota cycle per tenant.
 */
export async function withUsageCycleLock<T>(
  redis: Redis,
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
