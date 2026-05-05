import { Redis, type RedisOptions } from "ioredis";
import { config } from "../config.js";

const resilience: RedisOptions = {
  retryStrategy(times: number) {
    return Math.min(times * 500, 10_000);
  },
  reconnectOnError() {
    return true;
  },
};

/** Attach once per connection (including `connection.duplicate()`). */
export function listenRedisErrors(client: Redis, label: string): void {
  client.on("error", (err: Error) => {
    const code = "code" in err ? String((err as NodeJS.ErrnoException).code ?? "") : "";
    console.error(`[redis:${label}]${code ? ` ${code}` : ""} ${err.message}`);
  });
}

/**
 * Shared defaults for all ioredis clients (API, workers, BullMQ).
 * Use `extra` to override; BullMQ still needs `maxRetriesPerRequest: null` on the main connection.
 */
export function createRedisClient(label: string, extra: RedisOptions = {}): Redis {
  const client = new Redis(config.redisUrl, {
    ...resilience,
    maxRetriesPerRequest: null,
    ...extra,
  });
  listenRedisErrors(client, label);
  return client;
}
