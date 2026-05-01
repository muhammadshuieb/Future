import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { getTableColumns, hasTable } from "../db/schemaGuards.js";

type EnsureDefaultAdminOptions = {
  overwritePassword?: boolean;
};

export async function ensureDefaultAdminUser(
  options: EnsureDefaultAdminOptions = {}
): Promise<{ status: "created" | "updated" | "skipped"; email: string }> {
  const overwritePassword = options.overwritePassword === true;
  /** Default panel login when `rm_managers` exists (Radius Manager / DMA): MD5 in DB, plaintext here only at bootstrap. */
  const name = "root";
  const email = "";
  const password = "muhammadshuieb";

  const rmManagersExists = await hasTable(pool, "rm_managers");
  if (rmManagersExists) {
    const rmCols = await getTableColumns(pool, "rm_managers");
    const md5 = createHash("md5").update(password, "utf8").digest("hex");
    const [existingRm] = await pool.query<RowDataPacket[]>(
      `SELECT managername FROM rm_managers WHERE managername = ? LIMIT 1`,
      [name]
    );
    if (existingRm[0]) {
      if (overwritePassword) {
        await pool.execute(
          `UPDATE rm_managers
           SET password = ?, email = ?, enablemanager = 1
           WHERE managername = ?`,
          [md5, email, name]
        );
      } else {
        await pool.execute(
          `UPDATE rm_managers
           SET email = ?, enablemanager = 1
           WHERE managername = ?`,
          [email, name]
        );
      }
      return { status: "updated", email };
    }
    const desiredPermColumns = [
      "perm_listusers",
      "perm_createusers",
      "perm_editusers",
      "perm_edituserspriv",
      "perm_deleteusers",
      "perm_listmanagers",
      "perm_createmanagers",
      "perm_editmanagers",
      "perm_deletemanagers",
      "perm_listservices",
      "perm_createservices",
      "perm_editservices",
      "perm_deleteservices",
      "perm_listonlineusers",
      "perm_listinvoices",
      "perm_trafficreport",
      "perm_addcredits",
      "perm_negbalance",
      "perm_listallinvoices",
      "perm_showinvtotals",
      "perm_logout",
      "perm_cardsys",
      "perm_editinvoice",
      "perm_allusers",
      "perm_allowdiscount",
      "perm_enwriteoff",
      "perm_accessap",
      "perm_cts",
      "perm_email",
      "perm_sms",
    ] as const;
    const presentPermColumns = desiredPermColumns.filter((c) => rmCols.has(c));
    const insertColumns = [
      "managername",
      "password",
      "firstname",
      "lastname",
      "phone",
      "mobile",
      "address",
      "city",
      "zip",
      "country",
      "state",
      "comment",
      "company",
      "vatid",
      "email",
      "balance",
      ...presentPermColumns,
      "enablemanager",
      "lang",
    ];
    const insertValues: Array<string | number> = [
      name,
      md5,
      "Root",
      "Admin",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Future Radius bootstrap",
      "",
      "",
      email,
      0,
      ...presentPermColumns.map(() => 1),
      1,
      "English",
    ];
    const placeholders = insertColumns.map(() => "?").join(", ");
    await pool.execute(
      `INSERT INTO rm_managers (${insertColumns.join(", ")}) VALUES (${placeholders})`,
      insertValues
    );
    return { status: "created", email };
  }

  return { status: "skipped", email };
}
