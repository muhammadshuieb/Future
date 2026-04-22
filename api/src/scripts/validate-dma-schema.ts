/**
 * يتحقق أن قاعدة البيانات المستوردة مطابقة لعقد DMA المرجعي (نفس بنية radius.sql).
 */
import { pool } from "../db/pool.js";
import { validateDmaDatabase } from "../dma/validateDmaDatabase.js";

async function main() {
  const r = await validateDmaDatabase(pool);
  console.log(JSON.stringify(r, null, 2));
  await pool.end();
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
