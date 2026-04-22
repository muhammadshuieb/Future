/** @deprecated استخدم import-dma-subscribers.ts — نفس المنطق موحّد في importSubscribersFromDma */
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { importSubscribersFromDma } from "../dma/importSubscribersFromDma.js";

async function main() {
  const stats = await importSubscribersFromDma(pool, {
    tenantId: config.defaultTenantId,
    validateSchema: true,
    dryRun: false,
  });
  console.log(JSON.stringify(stats, null, 2));
  await pool.end();
  process.exit(stats.validation && !stats.validation.ok ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
