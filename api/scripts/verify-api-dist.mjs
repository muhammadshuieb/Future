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

const maintRestore = "dist/routes/maintenance-restore-sql.routes.js";
if (!fs.existsSync(maintRestore)) {
  fail("FATAL: maintenance-restore-sql.routes dist missing — rebuild image with current api/src");
}
const mrs = fs.readFileSync(maintRestore, "utf8");
if (!mrs.includes("/restore-sql") || !mrs.includes("importSqlFilePathIntoAppDatabase")) {
  fail("FATAL: maintenance-restore-sql.routes dist missing SQL restore handlers");
}

const distIndex = fs.readFileSync("dist/index.js", "utf8");
if (!distIndex.includes("maintenance-restore-sql.routes")) {
  fail("FATAL: dist/index.js must import maintenance-restore-sql.routes");
}

console.log("verify-api-dist: ok");
