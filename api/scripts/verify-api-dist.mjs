import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function dist(rel) {
  return path.join(apiRoot, "dist", rel);
}

const pkgPath = dist("routes/packages.routes.js");
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

const subPath = dist("routes/subscribers.routes.js");
const sub = fs.readFileSync(subPath, "utf8");
if (!sub.includes("querySubscribersList") && !sub.includes("joinNas")) {
  fail("FATAL: subscribers.routes dist missing list/NAS wiring — rebuild image with current api/src");
}

const distIndex = fs.readFileSync(dist("index.js"), "utf8");
if (distIndex.includes("maintenance-restore-sql")) {
  fail("FATAL: dist/index.js must not import retired maintenance-restore-sql.routes");
}

console.log("verify-api-dist: ok");
