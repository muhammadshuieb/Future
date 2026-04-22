import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { extendSubscriptionByDaysNoon, defaultExpirationNoonFromNow } from "../lib/billing.js";
import { validateDmaDatabase } from "./validateDmaDatabase.js";
import { hasTable } from "../db/schemaGuards.js";

export type DmaImportOptions = {
  tenantId: string;
  validateSchema: boolean;
  dryRun: boolean;
};

export type DmaImportStats = {
  usernamesConsidered: number;
  created: number;
  updated: number;
  skipped: number;
  validation?: Awaited<ReturnType<typeof validateDmaDatabase>>;
};

function pickIp(rm: RowDataPacket): string | null {
  const cpe = (rm.staticipcpe as string)?.trim();
  const cm = (rm.staticipcm as string)?.trim();
  if (cpe) return cpe;
  if (cm) return cm;
  return null;
}

function isRmEnabled(rm: RowDataPacket): boolean {
  const v = rm.enableuser;
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v === "bigint") return v === 1n;
  if (typeof v === "string") return v === "1";
  return false;
}

export async function importSubscribersFromDma(
  pool: Pool,
  options: DmaImportOptions
): Promise<DmaImportStats> {
  let validation: Awaited<ReturnType<typeof validateDmaDatabase>> | undefined;
  if (options.validateSchema) {
    validation = await validateDmaDatabase(pool);
    if (!validation.ok) {
      return {
        usernamesConsidered: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        validation,
      };
    }
  }

  const hasRad = await hasTable(pool, "radcheck");
  const hasRm = await hasTable(pool, "rm_users");
  if (!hasRad && !hasRm) {
    return {
      usernamesConsidered: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      validation,
    };
  }

  const [radRows] = await pool.query<RowDataPacket[]>(
    hasRad
      ? `SELECT DISTINCT username FROM radcheck
     WHERE attribute = 'Cleartext-Password' AND TRIM(username) <> ''`
      : `SELECT CAST(NULL AS CHAR) AS username WHERE 1=0`
  );
  const [rmRows] = await pool.query<RowDataPacket[]>(
    hasRm
      ? `SELECT username FROM rm_users WHERE TRIM(username) <> ''`
      : `SELECT CAST(NULL AS CHAR) AS username WHERE 1=0`
  );

  const userSet = new Set<string>();
  for (const r of radRows) userSet.add(r.username as string);
  for (const r of rmRows) userSet.add(r.username as string);
  const usernames = [...userSet].sort((a, b) => a.localeCompare(b));

  let created = 0;
  let updated = 0;
  const skipped = 0;

  for (const username of usernames) {
    let hasCleartext = false;
    if (hasRad) {
      const [pwdRows] = await pool.query<RowDataPacket[]>(
        `SELECT 1 FROM radcheck
         WHERE username = ? AND attribute = 'Cleartext-Password' LIMIT 1`,
        [username]
      );
      hasCleartext = !!pwdRows[0];
    }

    let rm: RowDataPacket | undefined;
    if (hasRm) {
      const [rmList] = await pool.query<RowDataPacket[]>(
        `SELECT username, enableuser, expiration, srvid, staticipcm, staticipcpe, mac, comment
         FROM rm_users WHERE username = ? LIMIT 1`,
        [username]
      );
      rm = rmList[0];
    }

    let packageId: string | null = null;
    if (rm?.srvid != null) {
      const [pkg] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM packages WHERE tenant_id = ? AND rm_srvid = ? LIMIT 1`,
        [options.tenantId, rm.srvid]
      );
      packageId = (pkg[0]?.id as string) ?? null;
    }

    let status: "active" | "disabled" = "disabled";
    if (hasCleartext) {
      if (rm) status = isRmEnabled(rm) ? "active" : "disabled";
      else status = "active";
    }

    const expiration = rm?.expiration
      ? extendSubscriptionByDaysNoon(new Date(rm.expiration as string), 0)
      : defaultExpirationNoonFromNow(30);

    const notes = rm?.comment
      ? String(rm.comment).slice(0, 65000)
      : "DMA import (radcheck ∪ rm_users)";
    const ip_address = rm ? pickIp(rm) : null;
    const mac_address = rm?.mac ? String(rm.mac).slice(0, 17) : null;

    const [subs] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM subscribers WHERE tenant_id = ? AND username = ? LIMIT 1`,
      [options.tenantId, username]
    );

    if (options.dryRun) {
      if (!subs[0]) created++;
      else updated++;
      continue;
    }

    if (!subs[0]) {
      await pool.execute(
        `INSERT INTO subscribers (id, tenant_id, username, status, package_id, expiration_date, notes, ip_address, mac_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          options.tenantId,
          username,
          status,
          packageId,
          expiration,
          notes,
          ip_address,
          mac_address,
        ]
      );
      created++;
    } else {
      await pool.execute(
        `UPDATE subscribers SET
           expiration_date = ?,
           status = ?,
           package_id = COALESCE(?, package_id),
           notes = ?,
           ip_address = COALESCE(?, ip_address),
           mac_address = COALESCE(?, mac_address)
         WHERE id = ?`,
        [expiration, status, packageId, notes, ip_address, mac_address, subs[0].id]
      );
      updated++;
    }
  }

  return {
    usernamesConsidered: usernames.length,
    created,
    updated,
    skipped,
    validation,
  };
}
