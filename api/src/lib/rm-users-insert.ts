import { createHash } from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";

type RmUsersColumn = RowDataPacket & {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
  COLUMN_DEFAULT: string | number | null;
};

function fallbackForType(dataType: string, nullable: boolean): string | number | null {
  if (nullable) return null;
  const t = dataType.toLowerCase();
  if (t.includes("int") || t === "decimal" || t === "numeric" || t === "float" || t === "double") {
    return 0;
  }
  if (t === "date") return "1970-01-01";
  if (t === "datetime" || t === "timestamp") return "1970-01-01 00:00:00";
  return "";
}

/**
 * Insert a Radius Manager–shaped rm_users row (primary key = username).
 * Password column uses MD5(hex) like typical RM exports; Cleartext-Password remains in radcheck.
 */
export async function insertRmUserRow(
  pool: Pool,
  input: {
    username: string;
    cleartextPassword: string;
    srvid: number;
    expiration: Date;
    accountType?: "subscription" | "card";
    firstname?: string;
    lastname?: string;
    phone?: string;
    mobile?: string;
    address?: string;
    email?: string;
    mac?: string;
    comment?: string;
    staticipcpe?: string;
  }
): Promise<void> {
  const md5pw = createHash("md5").update(input.cleartextPassword, "utf8").digest("hex");
  const fn = (input.firstname ?? "").slice(0, 50);
  const ln = (input.lastname ?? "").slice(0, 50);
  const phone = (input.phone ?? "").slice(0, 15);
  const mobile = (input.mobile ?? "").slice(0, 15);
  const address = (input.address ?? "").slice(0, 100);
  const email = (input.email ?? "").slice(0, 100);
  const mac = (input.mac ?? "").slice(0, 17);
  const comment = (input.comment ?? "").slice(0, 500);
  const staticipcpe = (input.staticipcpe ?? "").slice(0, 15);
  const [cols] = await pool.query<RmUsersColumn[]>(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rm_users'
     ORDER BY ORDINAL_POSITION`
  );
  if (!cols.length) {
    throw new Error("rm_users table not found");
  }
  const explicit: Record<string, string | number | Date | null> = {
    username: input.username,
    password: md5pw,
    groupid: 1,
    enableuser: 1,
    uplimit: 0,
    downlimit: 0,
    comblimit: 0,
    firstname: fn,
    lastname: ln,
    company: "",
    phone,
    mobile,
    address,
    city: "",
    zip: "",
    country: "",
    state: "",
    comment,
    gpslat: 0,
    gpslong: 0,
    mac,
    usemacauth: 0,
    expiration: input.expiration,
    uptimelimit: 0,
    srvid: input.srvid,
    staticipcm: "",
    staticipcpe,
    ipmodecm: 0,
    ipmodecpe: 0,
    poolidcm: 0,
    poolidcpe: 0,
    createdon: new Date().toISOString().slice(0, 10),
    acctype: input.accountType === "card" ? 1 : 0,
    credits: 0,
    cardfails: 0,
    createdby: "admin",
    owner: "admin",
    taxid: "",
    cnic: "",
    email,
    maccm: "",
    custattr: "",
    warningsent: 0,
    verifycode: "",
    verified: 0,
    selfreg: 0,
    verifyfails: 0,
    verifysentnum: 0,
    verifymobile: "",
    contractid: "",
    contractvalid: "1970-01-01",
    actcode: "",
    pswactsmsnum: 0,
    alertemail: 0,
    alertsms: 0,
    lang: "English",
    lastlogoff: null,
  };
  const insertCols = cols.map((c) => c.COLUMN_NAME);
  const values = cols.map((c) => {
    const name = c.COLUMN_NAME;
    if (Object.prototype.hasOwnProperty.call(explicit, name)) {
      return explicit[name];
    }
    if (c.COLUMN_DEFAULT !== null) return c.COLUMN_DEFAULT;
    return fallbackForType(c.DATA_TYPE, c.IS_NULLABLE === "YES");
  });
  await pool.execute(
    `INSERT INTO rm_users (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`,
    values
  );
}
