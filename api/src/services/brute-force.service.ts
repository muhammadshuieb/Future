import { Redis } from "ioredis";
import { createRedisClient } from "../lib/redis-connection.js";
import { authFailedTotal } from "./metrics.service.js";

/**
 * Brute-force login tracker backed by Redis sliding counters.
 *
 * Two independent windows track suspicious login pressure:
 *   - per-identifier (account targeting):  `bf:user:<id>`
 *   - per-source-IP   (credential stuffing): `bf:ip:<ip>`
 *
 * Counters expire after BF_WINDOW_SECONDS. When either crosses the threshold a
 * structured warning is emitted and an `auth_failed_total{reason="brute_force"}`
 * sample is published so Prometheus alert rules can fire — we deliberately do
 * NOT block in this layer (the `loginRateLimiter` middleware already handles
 * 429s); the tracker exists for visibility, not enforcement.
 */
const WINDOW_SECONDS = Math.max(60, Number(process.env.BF_WINDOW_SECONDS) || 300);
const THRESHOLD = Math.max(5, Number(process.env.BF_THRESHOLD) || 10);

let client: Redis | null = null;
function redis(): Redis {
  if (!client) client = createRedisClient("brute-force");
  return client;
}

function safeKey(prefix: string, value: string): string {
  return `bf:${prefix}:${value.replace(/[^a-zA-Z0-9._:@-]/g, "_").slice(0, 80)}`;
}

export interface LoginAttempt {
  surface: "panel" | "portal" | "api";
  identifier: string;
  ip: string;
  success: boolean;
}

export async function recordLoginAttempt(attempt: LoginAttempt): Promise<void> {
  if (attempt.success) {
    // Reset counters on success — a real owner just logged in from this identifier/IP.
    await Promise.all([
      redis().del(safeKey("user", attempt.identifier)),
      redis().del(safeKey("ip", attempt.ip)),
    ]).catch(() => {});
    return;
  }
  const userKey = safeKey("user", attempt.identifier);
  const ipKey = safeKey("ip", attempt.ip);
  const r = redis();
  const [userCount, ipCount] = await Promise.all([
    r.multi().incr(userKey).expire(userKey, WINDOW_SECONDS).exec().then((res) => Number(res?.[0]?.[1] ?? 0)),
    r.multi().incr(ipKey).expire(ipKey, WINDOW_SECONDS).exec().then((res) => Number(res?.[0]?.[1] ?? 0)),
  ]);
  const triggeredUser = userCount === THRESHOLD;
  const triggeredIp = ipCount === THRESHOLD;
  if (triggeredUser || triggeredIp) {
    authFailedTotal.inc({ surface: attempt.surface, reason: "brute_force" });
    console.warn(
      `[brute-force] threshold reached surface=${attempt.surface} identifier=${attempt.identifier} ip=${attempt.ip} userCount=${userCount} ipCount=${ipCount} window=${WINDOW_SECONDS}s`
    );
  }
}
