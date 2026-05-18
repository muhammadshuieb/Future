import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { hasColumn, hasTable } from "../../db/schemaGuards.js";
import { withTransaction } from "../../db/transaction.js";
import { writeAuditLog } from "../audit-log.service.js";
import { writeFinancialAudit } from "../financial-audit.service.js";
import { CoaService } from "../coa.service.js";
import { RadiusSyncService } from "../radius-sync.service.js";
import {
  getBillingContext,
  getFinancialReportJson,
  recordPackagePayment,
} from "../subscriber-billing.service.js";
import { sendSubscriberFinancialReportWhatsApp } from "../whatsapp.service.js";
import { createRmCardBatch, ensureRmCardsTable } from "../rm-cards.service.js";
import { syncRmCardToRadius } from "../rm-card-radius-sync.service.js";
import { listRouterHealthSnapshots } from "../infrastructure/router-health-collector.service.js";
import { listActiveAlerts } from "../infrastructure/infrastructure-alert-engine.service.js";
import { buildHelpText } from "./chatops-command-parser.service.js";
import { staffHasChatOpsPermission } from "./chatops-auth.service.js";
import type { ChatOpsStaffSession, ParsedChatOpsCommand } from "./chatops-types.js";
import type { ChatOpsSettingsView } from "./chatops-settings.service.js";

type ResolvedSubscriber = {
  id: string;
  username: string;
  status: string;
  expiration_date: string | null;
  package_name: string | null;
  phone: string | null;
  used_gb: number;
  debt: number;
  manager_name: string | null;
  online: boolean;
};

async function resolveSubscriber(
  pool: Pool,
  tenantId: string,
  query: string | undefined
): Promise<ResolvedSubscriber | null> {
  if (!query?.trim()) return null;
  const q = query.trim();
  const like = `%${q}%`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.username, s.status, s.expiration_date, s.phone,
            p.name AS package_name,
            COALESCE(s.used_bytes, 0) AS used_bytes,
            (
              SELECT COALESCE(SUM(i.amount), 0) FROM invoices i
              WHERE i.subscriber_id = s.id AND i.tenant_id = s.tenant_id AND i.status IN ('sent','overdue')
            ) AS debt,
            (
              SELECT u.name FROM users u WHERE u.id = s.responsible_manager_id LIMIT 1
            ) AS manager_name,
            (
              SELECT COUNT(*) FROM radacct r
              WHERE r.username = s.username AND r.acctstoptime IS NULL
            ) AS open_sessions
     FROM subscribers s
     LEFT JOIN packages p ON p.id = s.package_id AND p.tenant_id = s.tenant_id
     WHERE s.tenant_id = ?
       AND (s.username = ? OR s.username LIKE ? OR s.phone LIKE ? OR s.nickname LIKE ?)
     ORDER BY CASE WHEN s.username = ? THEN 0 ELSE 1 END, s.username
     LIMIT 1`,
    [tenantId, q, like, like, like, q]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    username: String(r.username),
    status: String(r.status ?? ""),
    expiration_date: r.expiration_date ? String(r.expiration_date).slice(0, 10) : null,
    package_name: r.package_name != null ? String(r.package_name) : null,
    phone: r.phone != null ? String(r.phone) : null,
    used_gb: Math.round((Number(r.used_bytes ?? 0) / (1024 * 1024 * 1024)) * 10) / 10,
    debt: Number(r.debt ?? 0),
    manager_name: r.manager_name != null ? String(r.manager_name) : null,
    online: Number(r.open_sessions ?? 0) > 0,
  };
}

async function resolvePackageId(pool: Pool, tenantId: string, token: string): Promise<string | null> {
  const t = token.trim();
  if (!t) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM packages
     WHERE tenant_id = ? AND (name = ? OR name LIKE ? OR mikrotik_rate_limit LIKE ?)
     ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [tenantId, t, `%${t}%`, `%${t}%`, t]
  );
  return rows[0]?.id != null ? String(rows[0].id) : null;
}

function statusLabelAr(status: string, online: boolean): string {
  if (online) return "متصل";
  const s = status.toLowerCase();
  if (s === "expired") return "منتهي";
  if (s === "disabled" || s === "suspended") return "معطّل";
  if (s === "active") return "غير متصل";
  return status;
}

function formatSubscriberDetails(sub: ResolvedSubscriber): string {
  return [
    "معلومات المشترك:",
    `الاسم: ${sub.username}`,
    `الحالة: ${statusLabelAr(sub.status, sub.online)}`,
    `الباقة: ${sub.package_name ?? "—"}`,
    `تاريخ الانتهاء: ${sub.expiration_date ?? "—"}`,
    `الاستهلاك: ${sub.used_gb}GB`,
    `الدين: ${sub.debt}`,
    `المدير المسؤول: ${sub.manager_name ?? "—"}`,
  ].join("\n");
}

export async function buildConfirmationSummary(
  pool: Pool,
  staff: ChatOpsStaffSession,
  cmd: ParsedChatOpsCommand
): Promise<string> {
  switch (cmd.type) {
    case "create_subscriber":
      return [
        "سيتم إنشاء المشترك:",
        `الاسم: ${cmd.args.username}`,
        `الباقة: ${cmd.args.package}`,
        `الهاتف: ${cmd.args.phone}`,
      ].join("\n");
    case "renew_subscriber": {
      const sub = await resolveSubscriber(pool, staff.tenantId, cmd.target);
      return [
        "سيتم تجديد الاشتراك:",
        `المشترك: ${sub?.username ?? cmd.target}`,
        `المدة: ${cmd.args.period}`,
      ].join("\n");
    }
    case "disconnect_user":
    case "disconnect_all_sessions":
      return `سيتم فصل المشترك: ${cmd.target}`;
    case "collect_payment":
      return `سيتم تحصيل مبلغ ${cmd.args.amount} للمشترك ${cmd.target}`;
    case "print_prepaid_cards":
      return `سيتم إنشاء ${cmd.args.quantity} كرت باقة ${cmd.args.package}`;
    case "send_invoice": {
      const sub = await resolveSubscriber(pool, staff.tenantId, cmd.target);
      return `سيتم إرسال تقرير مالي للمشترك ${sub?.username ?? cmd.target}`;
    }
    default:
      return `تأكيد تنفيذ: ${cmd.type}`;
  }
}

export async function executeChatOpsCommand(
  pool: Pool,
  staff: ChatOpsStaffSession,
  cmd: ParsedChatOpsCommand,
  settings: ChatOpsSettingsView,
  skipConfirmation = false
): Promise<string> {
  if (cmd.type === "help") return buildHelpText();

  if (cmd.type === "unknown") {
    return "لم أفهم الأمر. اكتب «مساعدة» لعرض الأمثلة.";
  }

  if (cmd.permission && !staffHasChatOpsPermission(staff, cmd.permission as never)) {
    return "لا تملك صلاحية تنفيذ هذا الأمر.";
  }

  if (cmd.requiresConfirmation && !skipConfirmation) {
    return "__NEEDS_CONFIRMATION__";
  }

  const coa = new CoaService(pool);
  const tenantId = staff.tenantId;

  switch (cmd.type) {
    case "subscriber_details":
    case "subscriber_status": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      return formatSubscriberDetails(sub);
    }
    case "subscriber_sessions": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      if (!(await hasTable(pool, "radacct"))) return "لا توجد بيانات جلسات.";
      const [sessions] = await pool.query<RowDataPacket[]>(
        `SELECT radacctid, nasipaddress, acctstarttime, framedipaddress
         FROM radacct WHERE username = ? AND acctstoptime IS NULL ORDER BY acctstarttime DESC LIMIT 10`,
        [sub.username]
      );
      if (!sessions.length) return `لا توجد جلسات نشطة للمشترك ${sub.username}.`;
      const lines = sessions.map(
        (s, i) =>
          `${i + 1}. NAS ${s.nasipaddress} — IP ${s.framedipaddress ?? "—"} — منذ ${String(s.acctstarttime).slice(0, 19)}`
      );
      return `جلسات ${sub.username}:\n${lines.join("\n")}`;
    }
    case "subscriber_invoice": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      const ctx = await getBillingContext(pool, tenantId, sub.id);
      if (!ctx) return "لا توجد بيانات فوترة.";
      return [
        `فوترة ${sub.username}:`,
        `المستحق: ${ctx.arrears_total ?? 0}`,
        `فواتير غير مدفوعة: ${ctx.unpaid_invoices?.length ?? 0}`,
        `العملة: ${ctx.subscriber?.currency ?? "—"}`,
      ].join("\n");
    }
    case "online_count": {
      let online = 0;
      if (await hasTable(pool, "radacct")) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(DISTINCT r.username) AS c
           FROM radacct r
           INNER JOIN subscribers s ON s.username = r.username AND s.tenant_id = ?
           WHERE r.acctstoptime IS NULL AND r.username <> ''`,
          [tenantId]
        );
        online = Number(rows[0]?.c ?? 0);
      }
      return `عدد المتصلين الآن: ${online}`;
    }
    case "servers_status": {
      const routers = await listRouterHealthSnapshots(pool, tenantId);
      if (!routers.length) return "لا توجد بيانات راوترات.";
      const lines = routers.slice(0, 15).map((r) => {
        const st = r.health_status === "online" ? "متصل" : "غير متصل";
        return `• ${r.nas_name}: ${st}`;
      });
      const offline = routers.filter((r) => r.health_status !== "online").length;
      return [`حالة السيرفرات (${routers.length}):`, ...lines, `المتوقفة: ${offline}`].join("\n");
    }
    case "current_alerts": {
      const alerts = await listActiveAlerts(pool, tenantId, 10);
      if (!alerts.length) return "لا توجد تنبيهات نشطة.";
      return alerts
        .map(
          (a) =>
            `• [${a.severity}] ${a.alert_type ?? a.title ?? "تنبيه"} — ${a.nas_name_resolved ?? a.nas_device_id ?? ""}`
        )
        .join("\n");
    }
    case "manager_wallet": {
      const nameQ = cmd.target?.trim();
      if (!nameQ) return "حدد اسم المدير.";
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT u.name, u.wallet_balance, u.allowed_negative_balance
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = ? AND r.name = 'manager' AND (u.name LIKE ? OR u.email LIKE ?)
         LIMIT 1`,
        [tenantId, `%${nameQ}%`, `%${nameQ}%`]
      );
      const m = rows[0];
      if (!m) return "لم يتم العثور على المدير.";
      return [
        `رصيد المدير ${m.name}:`,
        `المحفظة: ${Number(m.wallet_balance ?? 0)}`,
        `السماح بالسالب: ${Number(m.allowed_negative_balance ?? 0)}`,
      ].join("\n");
    }
    case "daily_report": {
      const today = new Date().toISOString().slice(0, 10);
      const [pay] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
         WHERE tenant_id = ? AND DATE(paid_at) = ?`,
        [tenantId, today]
      );
      const [inv] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM invoices WHERE tenant_id = ? AND DATE(issue_date) = ?`,
        [tenantId, today]
      );
      return [
        `تقرير اليوم (${today}):`,
        `إيرادات محصّلة: ${Number(pay[0]?.total ?? 0)}`,
        `فواتير جديدة: ${Number(inv[0]?.c ?? 0)}`,
      ].join("\n");
    }
    case "send_invoice": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      const report = await getFinancialReportJson(pool, tenantId, sub.id);
      if (!report) return "لا يوجد تقرير مالي.";
      const body = typeof report === "object" ? JSON.stringify(report, null, 2).slice(0, 1500) : String(report);
      const sent = await sendSubscriberFinancialReportWhatsApp({
        tenantId,
        subscriberId: sub.id,
        messageBody: `تقرير مالي — ${sub.username}\n${body}`,
      });
      return sent.sent ? "تم إرسال التقرير عبر واتساب." : `تعذر الإرسال: ${sent.reason ?? "خطأ"}`;
    }
    case "disconnect_user":
    case "disconnect_all_sessions": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      const report = await coa.disconnectAllSessions(sub.username, tenantId);
      await writeAuditLog(pool, {
        tenantId,
        staffId: staff.staffUserId,
        action: "chatops_disconnect",
        entityType: "subscriber",
        entityId: sub.id,
        payload: { username: sub.username, report },
      });
      return report.anyOk
        ? `تم فصل جلسات ${sub.username}.`
        : `تعذر الفصل لبعض الجلسات. تحقق من CoA.`;
    }
    case "renew_subscriber": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      const amount = Number(cmd.args.amount ?? 0);
      if (
        staff.role !== "admin" &&
        amount > settings.max_financial_amount_non_admin
      ) {
        return `المبلغ يتجاوز الحد المسموح (${settings.max_financial_amount_non_admin}).`;
      }
      const result = await recordPackagePayment(pool, tenantId, sub.id, {
        invoice_amount: amount > 0 ? amount : 1,
        currency: "SYP",
        payment_method: "manual",
        pay_timing: "immediate",
      }, { role: staff.role, sub: staff.staffUserId });
      if (!result.ok) return `فشل التجديد: ${result.error}`;
      await writeFinancialAudit(pool, {
        tenantId,
        staffId: staff.staffUserId,
        action: "chatops_renew",
        entityType: "subscriber",
        entityId: sub.id,
        payload: { period: cmd.args.period },
      });
      return `تم تجديد اشتراك ${sub.username}.`;
    }
    case "collect_payment": {
      const sub = await resolveSubscriber(pool, tenantId, cmd.target);
      if (!sub) return "لم يتم العثور على المشترك.";
      const amount = Number(cmd.args.amount ?? 0);
      if (!amount || amount <= 0) return "حدد مبلغاً صحيحاً.";
      if (staff.role !== "admin" && amount > settings.max_financial_amount_non_admin) {
        return `المبلغ يتجاوز الحد المسموح.`;
      }
      const result = await recordPackagePayment(pool, tenantId, sub.id, {
        invoice_amount: amount,
        currency: "SYP",
        payment_method: "manual",
        pay_timing: "immediate",
      }, { role: staff.role, sub: staff.staffUserId });
      if (!result.ok) return `فشل التحصيل: ${result.error}`;
      return `تم تحصيل ${amount} من ${sub.username}.`;
    }
    case "create_subscriber": {
      const username = String(cmd.args.username ?? "").trim();
      const password = String(cmd.args.password ?? "").trim();
      const phone = String(cmd.args.phone ?? "").trim();
      const pkgToken = String(cmd.args.package ?? "").trim();
      if (!username || !password) return "الاسم وكلمة السر مطلوبان.";
      const packageId = pkgToken ? await resolvePackageId(pool, tenantId, pkgToken) : null;
      if (pkgToken && !packageId) return "الباقة غير موجودة.";
      const id = randomUUID();
      const exp = new Date();
      exp.setDate(exp.getDate() + 30);
      const expStr = exp.toISOString().slice(0, 10);
      const cols = ["id", "tenant_id", "username", "status", "expiration_date"];
      const vals: unknown[] = [id, tenantId, username, "active", expStr];
      if (packageId) {
        cols.push("package_id");
        vals.push(packageId);
      }
      if (phone && (await hasColumn(pool, "subscribers", "phone"))) {
        cols.push("phone");
        vals.push(phone);
      }
      if (staff.role === "manager" && (await hasColumn(pool, "subscribers", "responsible_manager_id"))) {
        cols.push("responsible_manager_id", "created_by_manager_id");
        vals.push(staff.staffUserId, staff.staffUserId);
      }
      await pool.execute(
        `INSERT INTO subscribers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        vals as (string | number | null)[]
      );
      await pool.execute(
        `INSERT INTO subscriber_credentials (subscriber_id, tenant_id, password) VALUES (?, ?, ?)`,
        [id, tenantId, password]
      );
      const radiusSync = new RadiusSyncService(pool);
      await radiusSync.syncSubscriber(id, tenantId).catch(() => {});
      await writeAuditLog(pool, {
        tenantId,
        staffId: staff.staffUserId,
        action: "chatops_create_subscriber",
        entityType: "subscriber",
        entityId: id,
        payload: { username, packageId },
      });
      return `تم إنشاء المشترك ${username}.`;
    }
    case "print_prepaid_cards": {
      const qty = Number(cmd.args.quantity ?? 0);
      const pkgToken = String(cmd.args.package ?? "");
      if (qty < 1 || qty > settings.max_prepaid_cards_per_command) {
        return `العدد يجب أن يكون بين 1 و ${settings.max_prepaid_cards_per_command}.`;
      }
      const packageId = await resolvePackageId(pool, tenantId, pkgToken);
      if (!packageId) return "الباقة غير موجودة.";
      await ensureRmCardsTable(pool);
      const validTill = new Date();
      validTill.setMonth(validTill.getMonth() + 1);
      const batchKey = `chatops-${staff.staffUserId}-${Date.now()}`;
      const result = await withTransaction(async (conn) =>
        createRmCardBatch(
          conn,
          pool,
          tenantId,
          {
            quantity: qty,
            card_type: "classic",
            gross_card_value: 0,
            valid_till: validTill.toISOString().slice(0, 10),
            prefix: "C",
            pin_length: 8,
            password_length: 6,
            package_id: packageId,
            download_limit_mb: 0,
            upload_limit_mb: 0,
            total_limit_mb: 0,
            online_time_limit: 0,
            available_time_from_activation: 0,
            simultaneous_use: 1,
          },
          {
            role: staff.role,
            sub: staff.staffUserId,
            kind: "print",
            client_batch_key: batchKey,
          }
        )
      );
      for (const task of result.syncTasks) {
        await syncRmCardToRadius(pool, task).catch(() => {});
      }
      await writeAuditLog(pool, {
        tenantId,
        staffId: staff.staffUserId,
        action: "chatops_prepaid_batch",
        entityType: "rm_cards_series",
        entityId: result.series,
        payload: { created: result.created, batch_id: result.batch_id },
      });
      return `تم إنشاء ${result.created} كرت (سلسلة ${result.series}).`;
    }
    case "nas_status":
    case "nas_metric": {
      const name = cmd.target ?? "";
      const routers = await listRouterHealthSnapshots(pool, tenantId);
      const r = routers.find(
        (x) =>
          String(x.nas_name ?? "").toLowerCase().includes(name.toLowerCase()) ||
          String(x.nas_ip ?? "").includes(name)
      );
      if (!r) return "الراوتر غير موجود.";
      if (cmd.type === "nas_status") {
        return [
          `حالة ${r.nas_name}:`,
          `الاتصال: ${r.health_status === "online" ? "متصل" : "غير متصل"}`,
          `CPU: ${r.cpu_percent ?? "—"}%`,
          `RAM: ${r.ram_percent ?? "—"}%`,
          `حرارة: ${r.board_temperature_c ?? "—"}°C`,
        ].join("\n");
      }
      const metric = String(cmd.args.metric ?? "").toLowerCase();
      if (/حرار/.test(metric)) return `حرارة ${r.nas_name}: ${r.board_temperature_c ?? "—"}°C`;
      if (/cpu|معالج/.test(metric)) return `المعالج ${r.nas_name}: ${r.cpu_percent ?? "—"}%`;
      if (/ram|رام/.test(metric)) return `الذاكرة ${r.nas_name}: ${r.ram_percent ?? "—"}%`;
      return `مقاييس ${r.nas_name}: CPU ${r.cpu_percent ?? "—"}% — RAM ${r.ram_percent ?? "—"}%`;
    }
    default:
      return "الأمر غير مدعوم بعد.";
  }
}

export async function executeConfirmedPayload(
  pool: Pool,
  staff: ChatOpsStaffSession,
  commandType: string,
  payload: Record<string, unknown>,
  settings: ChatOpsSettingsView
): Promise<string> {
  const cmd: ParsedChatOpsCommand = {
    type: commandType as ParsedChatOpsCommand["type"],
    args: payload as Record<string, string | number | boolean>,
    target: payload.target != null ? String(payload.target) : undefined,
    requiresConfirmation: false,
    permission: null,
  };
  return executeChatOpsCommand(pool, staff, cmd, settings, true);
}
