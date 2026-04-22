/**
 * عقد توافق قاعدة بيانات Radius Manager (DMA) + FreeRADIUS
 * مُستخرَج من ملف المرجع: radius.sql (نفس تنسيق phpMyAdmin / DMA Softlab).
 *
 * أي مستورد مستقبلي لملف SQL بنفس أسماء الجداول/الأعمدة الحرجة يبقى متوافقاً مع منطق الاستيراد.
 */

/**
 * نفس اسم القاعدة في ملف الـ dump المرجعي:
 * `-- Database: radius`
 */
export const DMA_DATABASE_NAME = "radius" as const;

/** يُستخدم للتحقق من أن القاعدة تحوي كل جداول ملف radius.sql المرجعي */
export const DMA_REFERENCE_DUMP_TABLES: readonly string[] = [
  "nas",
  "radacct",
  "radcheck",
  "radgroupcheck",
  "radgroupreply",
  "radippool",
  "radpostauth",
  "radreply",
  "radusergroup",
  "rm_actsrv",
  "rm_allowedmanagers",
  "rm_allowednases",
  "rm_ap",
  "rm_cards",
  "rm_changesrv",
  "rm_cmts",
  "rm_colsetlistdocsis",
  "rm_colsetlistradius",
  "rm_colsetlistusers",
  "rm_dailyacct",
  "rm_ias",
  "rm_invoices",
  "rm_ippools",
  "rm_managers",
  "rm_newusers",
  "rm_onlinecm",
  "rm_phpsess",
  "rm_radacct",
  "rm_services",
  "rm_settings",
  "rm_specperacnt",
  "rm_specperbw",
  "rm_syslog",
  "rm_usergroups",
  "rm_users",
  "rm_wlan",
] as const;

/**
 * أقل مجموعة أعمدة يجب أن تظل موجودة في النسخ المستوردة حتى يعمل الاستيراد والمزامنة.
 * (التحقق لا يمنع أعمدة إضافية في نسخ أحدث من DMA.)
 */
export const DMA_MINIMUM_COLUMNS: Record<string, readonly string[]> = {
  radcheck: ["id", "username", "attribute", "op", "value"],
  rm_users: [
    "username",
    "password",
    "groupid",
    "enableuser",
    "expiration",
    "srvid",
    "staticipcm",
    "staticipcpe",
    "mac",
    "comment",
    "firstname",
    "lastname",
    "email",
  ],
  radreply: ["id", "username", "attribute", "op", "value"],
  radusergroup: ["username", "groupname", "priority"],
  radacct: [
    "radacctid",
    "username",
    "acctinputoctets",
    "acctoutputoctets",
    "acctstarttime",
    "acctstoptime",
    "nasipaddress",
    "acctsessionid",
  ],
  nas: ["id", "nasname", "secret", "shortname", "type"],
  rm_services: ["srvid", "srvname", "combquota", "dlquota", "ulquota", "enableservice"],
};

export const CONTRACT_VERSION = "1.0.0-radius-sql-dma-reference";
