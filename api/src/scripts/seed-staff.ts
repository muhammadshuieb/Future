import { ensureDefaultAdminUser } from "../services/bootstrap-admin.service.js";

async function main() {
  const result = await ensureDefaultAdminUser({ overwritePassword: true });
  console.log(`Seeded staff (${result.status}): ${result.email} (change password in production)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
