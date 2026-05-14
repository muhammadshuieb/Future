import { pool } from "../db/pool.js";

/** Legacy billing DDL paths removed — invoices/payments are created by migrations. */
export async function ensureBillingTables(): Promise<void> {
  if (String(process.env.SKIP_BILLING_SCHEMA_BOOTSTRAP ?? "").trim() === "1") {
    return;
  }
}

export async function ensureSubscriberWhatsAppOptOutColumn(): Promise<void> {
  /* Column `whatsapp_opt_out` is defined on `subscribers` in initial migration. */
}
