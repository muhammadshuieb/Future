/**
 * عقد توافق قاعدة بيانات Radius Manager (DMA) + جداول RADIUS القديمة في التصدير.
 * مصدر الحقيقة لشكل الجداول داخل المستودع: `sql/radius-dma-baseline.sql`
 * (نسخة مطابقة لتصدير phpMyAdmin / DMA — سابقاً radius.sql على سطح المكتب).
 *
 * أي استعادة SQL بنفس أسماء الجداول/الأعمدة الحرجة تبقى متوافقة مع منطق الاستيراد والتحقق.
 */

/**
 * نفس اسم القاعدة في ملف الـ dump المرجعي:
 * `-- Database: radius`
 * (يمكن الاتصال بقاعدة باسم آخر عبر DATABASE_URL؛ التحقق الاختياري بـ RM_DATABASE_NAME.)
 */
export const DMA_DATABASE_NAME = "radius" as const;

/** ملاحظة: جدول `rm_payments` شائع في نسخ DMA لكنه غير موجود في نسخة radius.sql المرجعية المستخدمة هنا؛ عند ظهوره في نسختك أضف فحوصاً منفصلة. */

/** يُستخدم للتحقق من أن القاعدة تحوي كل جداول sql/radius-dma-baseline.sql */
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

/** Optional in some DMA / conntrack exports (not in `radius-dma-baseline.sql`); queried when present. */
export const DMA_OPTIONAL_TABLES = ["rm_cumulate", "rm_conntrack"] as const;

export const CONTRACT_VERSION = "1.2.0-dma-native-optional-cumulate-conntrack";
