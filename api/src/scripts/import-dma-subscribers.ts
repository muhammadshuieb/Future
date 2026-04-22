/**
 * استيراد كامل للمشتركين من DMA: اتحاد radcheck (Cleartext-Password) و rm_users
 *
 * --seed-packages : يزامن packages من rm_services أولاً (موصى به قبل أول استيراد)
 * --dry-run       : بدون كتابة
 * --no-validate   : تخطي التحقق من الجداول (أسرع؛ غير موصى به بعد استيراد ملف جديد)
 */
import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { importSubscribersFromDma } from "../dma/importSubscribersFromDma.js";
import { seedPackagesFromRmServices } from "../dma/seedPackagesFromRmServices.js";

async function main() {
  const argv = new Set(process.argv.slice(2));
  const dryRun = argv.has("--dry-run");
  const noValidate = argv.has("--no-validate");
  const seedPackages = argv.has("--seed-packages");

  if (seedPackages) {
    const s = await seedPackagesFromRmServices(pool, config.defaultTenantId);
    console.log(JSON.stringify({ step: "seed-packages", ...s }, null, 2));
  }

  const stats = await importSubscribersFromDma(pool, {
    tenantId: config.defaultTenantId,
    validateSchema: !noValidate,
    dryRun,
  });

  console.log(JSON.stringify({ step: "import-subscribers", ...stats }, null, 2));
  if (stats.validation && !stats.validation.ok) {
    console.error("فشل التحقق: راجع missingTables و columnMismatches أعلاه.");
  }
  await pool.end();
  process.exit(stats.validation && !stats.validation.ok ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
