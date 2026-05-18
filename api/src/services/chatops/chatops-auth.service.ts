import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { hasTable } from "../../db/schemaGuards.js";
import {
  defaultChatOpsPermissionsAllOn,
  defaultChatOpsPermissionsManager,
  hasChatOpsPermission,
  normalizeChatOpsPermissions,
  type ChatOpsPermissionKey,
  type ChatOpsStaffContext,
} from "../../lib/chatops-permissions.js";
import { parsePermissionsObject } from "../../lib/manager-permissions.js";
import type { ChatOpsChannel, ChatOpsStaffSession } from "./chatops-types.js";

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length < 8) return null;
  return p;
}

export async function findStaffByChatIdentity(
  pool: Pool,
  tenantId: string,
  channel: ChatOpsChannel,
  externalId: string,
  phoneNumber: string | null
): Promise<ChatOpsStaffSession | null> {
  if (!(await hasTable(pool, "staff_chat_identities"))) return null;
  if (!(await hasTable(pool, "users"))) return null;

  const ext = externalId.trim();
  const phone = normalizePhone(phoneNumber);

  const [byExt] = await pool.query<RowDataPacket[]>(
    `SELECT sci.staff_user_id, sci.phone_number, u.name, u.status, u.permissions_json,
            (
              SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id
              ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'accountant' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END
              LIMIT 1
            ) AS role_name
     FROM staff_chat_identities sci
     JOIN users u ON u.id = sci.staff_user_id AND u.tenant_id = sci.tenant_id
     WHERE sci.tenant_id = ? AND sci.channel = ? AND sci.external_id = ? AND sci.is_active = 1
     LIMIT 1`,
    [tenantId, channel, ext]
  );

  let row = byExt[0];
  if (!row && phone) {
    const [byPhone] = await pool.query<RowDataPacket[]>(
      `SELECT sci.staff_user_id, sci.phone_number, u.name, u.status, u.permissions_json,
              (
                SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id
                ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'accountant' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END
                LIMIT 1
              ) AS role_name
       FROM staff_chat_identities sci
       JOIN users u ON u.id = sci.staff_user_id AND u.tenant_id = sci.tenant_id
       WHERE sci.tenant_id = ? AND sci.channel = ? AND sci.is_active = 1
         AND REPLACE(REPLACE(REPLACE(sci.phone_number, '+', ''), ' ', ''), '-', '') LIKE ?
       LIMIT 1`,
      [tenantId, channel, `%${phone.slice(-9)}`]
    );
    row = byPhone[0];
  }

  if (!row) return null;
  if (String(row.status ?? "active").toLowerCase() !== "active") return null;

  const role = String(row.role_name ?? "viewer");
  const userOverride = parsePermissionsObject(row.permissions_json ?? {});
  let chatopsPerms = defaultChatOpsPermissionsManager();
  if (role === "admin") {
    chatopsPerms = defaultChatOpsPermissionsAllOn();
  } else if (await hasTable(pool, "staff_role_permissions")) {
    const [rp] = await pool.query<RowDataPacket[]>(
      `SELECT permissions_json FROM staff_role_permissions WHERE tenant_id = ? AND role = ? LIMIT 1`,
      [tenantId, role]
    );
    const roleDefaults = normalizeChatOpsPermissions(rp[0]?.permissions_json ?? {});
    chatopsPerms = normalizeChatOpsPermissions({ ...roleDefaults, ...userOverride });
  } else {
    chatopsPerms = normalizeChatOpsPermissions(userOverride);
  }

  const permissions: Record<string, boolean> = { ...userOverride, ...chatopsPerms };
  if (!hasChatOpsPermission({ role, permissions }, "chatops:use")) return null;

  return {
    tenantId,
    staffUserId: String(row.staff_user_id),
    staffName: String(row.name ?? ""),
    role,
    permissions,
    channel,
    externalSenderId: ext,
    phoneNumber: phone ?? normalizePhone(row.phone_number as string),
  };
}

export function staffHasChatOpsPermission(
  staff: ChatOpsStaffSession,
  key: ChatOpsPermissionKey
): boolean {
  return hasChatOpsPermission(
    { role: staff.role, permissions: staff.permissions } satisfies ChatOpsStaffContext,
    key
  );
}

export type StaffChatIdentityView = {
  id: string;
  staff_user_id: string;
  staff_name: string;
  channel: ChatOpsChannel;
  external_id: string;
  phone_number: string | null;
  display_name: string | null;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
};

export async function listStaffChatIdentities(
  pool: Pool,
  tenantId: string
): Promise<StaffChatIdentityView[]> {
  if (!(await hasTable(pool, "staff_chat_identities"))) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT sci.*, u.name AS staff_name
     FROM staff_chat_identities sci
     JOIN users u ON u.id = sci.staff_user_id
     WHERE sci.tenant_id = ?
     ORDER BY sci.created_at DESC`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    staff_user_id: String(r.staff_user_id),
    staff_name: String(r.staff_name ?? ""),
    channel: r.channel as ChatOpsChannel,
    external_id: String(r.external_id),
    phone_number: r.phone_number != null ? String(r.phone_number) : null,
    display_name: r.display_name != null ? String(r.display_name) : null,
    is_active: Boolean(r.is_active),
    verified_at: r.verified_at ? new Date(String(r.verified_at)).toISOString() : null,
    created_at: new Date(String(r.created_at)).toISOString(),
  }));
}
