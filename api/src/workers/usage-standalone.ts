/**
 * Optional isolated process for usage/quota/expiry cycles only.
 * Run when main BullMQ worker sets SKIP_BULLMQ_UPDATE_USAGE=1 so a CoA-heavy crash
 * does not stop backups/WhatsApp jobs (and vice versa).
 *
 *   UPDATE_USAGE_EVERY_MS=60000 node dist/workers/usage-standalone.js
 */

import { config } from "../config.js";
import { pool, waitForDbReady } from "../db/pool.js";
import { installLogger, markDbReady, log } from "../services/logger.service.js";
import { runUsageAndExpiryCycle } from "../worker/usage.worker.js";

installLogger({ source: "usage-worker" });

const everyMs = Math.max(60_000, parseInt(process.env.UPDATE_USAGE_EVERY_MS ?? "60000", 10) || 60_000);

async function tick() {
  try {
    await runUsageAndExpiryCycle();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`usage_standalone_cycle_failed ${msg}`, {}, "usage-worker");
    console.error("[usage-standalone] cycle failed", e);
  }
}

async function main() {
  await waitForDbReady();
  markDbReady();
  log.info(`usage_standalone started everyMs=${everyMs}`, {}, "usage-worker");
  await tick();
  setInterval(tick, everyMs);
}

main().catch((e) => {
  console.error("[usage-standalone] fatal", e);
  process.exit(1);
});
