import fs from "node:fs";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const pkgPath = "dist/routes/packages.routes.js";
const pkg = fs.readFileSync(pkgPath, "utf8");
if (
  pkg.includes(
    "INSERT INTO packages (id, tenant_id, name, mikrotik_rate_limit, framed_ip_address, mikrotik_address_list",
  )
) {
  fail("FATAL: packages.routes dist still has static INSERT — rebuild image with current api/src");
}
if (!pkg.includes("fields.join")) {
  fail("FATAL: packages.routes dist missing dynamic INSERT");
}

const subPath = "dist/routes/subscribers.routes.js";
const sub = fs.readFileSync(subPath, "utf8");
if (!sub.includes("joinNas")) {
  fail("FATAL: subscribers.routes dist missing joinNas guard — rebuild image with current api/src");
}

console.log("verify-api-dist: ok");
