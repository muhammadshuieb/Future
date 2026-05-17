import type { AlertSeverity, InfrastructureAlertType } from "./infrastructure-types.js";

export type AlertGuidance = {
  severityLabel: string;
  maintenanceRequired: boolean;
  maintenanceUrgency: "none" | "soon" | "urgent";
  maintenanceText: string;
  resolutionSteps: string[];
};

const DEFAULT_GUIDANCE: AlertGuidance = {
  severityLabel: "غير محدد",
  maintenanceRequired: false,
  maintenanceUrgency: "none",
  maintenanceText: "لا — راقب الوضع",
  resolutionSteps: ["راجع لوحة مراقبة البنية (NOC) للتفاصيل.", "إن استمر التنبيه، تواصل مع الدعم الفني."],
};

const GUIDANCE: Partial<Record<InfrastructureAlertType, Omit<AlertGuidance, "severityLabel"> & { severityLabel?: string }>> = {
  router_offline: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "تحقق من الكهرباء والكابل بين السيرفر والراوتر.",
      "جرّب ping لـ IP الراوتر من السيرفر.",
      "تأكد من منفذ MikroTik API واليوزر/كلمة المرور في صفحة NAS.",
      "إن كان الراوتر يعمل: أعد تشغيل خدمة API أو الراوتر بعد أخذ نسخة.",
    ],
  },
  high_cpu: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم — خلال ساعات",
    resolutionSteps: [
      "افتح Winbox/WebFig وراجع Tools → Profile لمعرفة العملية المستهلكة.",
      "أوقف سكربتات أو مهام مجدولة غير ضرورية.",
      "حدّث RouterOS إن كان الإصدار قديماً.",
      "فكّر بتوسيع الباقة أو تقليل عدد الجلسات إن كان الحمل طبيعياً.",
    ],
  },
  high_ram: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم — خلال ساعات",
    resolutionSteps: [
      "راجع System → Resources في MikroTik.",
      "أعد تشغيل الخدمات الثقيلة أو الراوتر في وقت صيانة مخطط.",
      "تحقق من تسريب ذاكرة بعد تحديث أخير — راجع سجل التحديثات.",
    ],
  },
  high_temperature: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "تحقق من التهوية والمراوح وغبار الجهاز.",
      "انقل الراوتر بعيداً عن أشعة الشمس أو مصدر حرارة.",
      "خفّف الحمل مؤقتاً حتى تنخفض الحرارة.",
      "استبدل مروحة/مزود طاقة إن لزم.",
    ],
  },
  low_voltage: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "تحقق من مصدر الطاقة (محول/بطارية/UPS).",
      "استبدل محول الطاقة إن كان تالفاً أو ضعيفاً.",
      "تأكد من جودة التوصيلات — ارتخاء الوصلات يخفض الجهد.",
      "لا تترك الراوتر يعمل بجهد منخفض لفترة طويلة.",
    ],
  },
  interface_down: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم",
    resolutionSteps: [
      "حدد الواجهة المتوقفة من Winbox → Interfaces.",
      "تحقق من الكابل والـ SFP والمنفذ الفيزيائي.",
      "فعّل الواجهة أو أعد توصيل الكابل.",
    ],
  },
  ppp_session_drop: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم — إن تكرر",
    resolutionSteps: [
      "راجع سجل PPP و Radius — هل هناك انقطاع جماعي؟",
      "تحقق من حمل CPU/RAM على الراوتر.",
      "راجع مشاكل مزود الإنترنت أو خط الربط.",
    ],
  },
  server_down: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "تحقق من تشغيل السيرفر (SSH أو لوحة الاستضافة).",
      "راجع MySQL و Redis و Worker: docker compose ps أو systemctl.",
      "أعد تشغيل الخدمات المتوقفة بالترتيب: DB → Redis → API → Worker.",
    ],
  },
  high_server_cpu: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم",
    resolutionSteps: [
      "راجع العمليات على السيرفر (top/htop).",
      "أوقف مهام ثقيلة مؤقتاً (نسخ احتياطي، فحص شامل).",
      "وسّع موارد السيرفر إن كان الحمل طبيعياً.",
    ],
  },
  high_server_ram: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم",
    resolutionSteps: [
      "راجع استهلاك الذاكرة لكل حاوية/خدمة.",
      "أعد تشغيل Worker أو API إن كان هناك تسريب.",
      "نظّف سجلات قديمة أو ملفات مؤقتة كبيرة.",
    ],
  },
  disk_almost_full: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "احذف نسخاً احتياطية قديمة أو سجلات غير ضرورية.",
      "وسّع القرص أو انقل البيانات لقرص آخر.",
      "فعّل الاحتفاظ التلقائي (retention) للسجلات.",
      "لا تؤجل — امتلاء القرص يوقف النظام.",
    ],
  },
  service_down: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "حدد الخدمة المتوقفة من نص التنبيه (MySQL/Redis/Worker).",
      "راجع سجلات الحاوية أو journalctl.",
      "أعد تشغيل الخدمة ثم تحقق من لوحة NOC.",
    ],
  },
  radius_down: {
    maintenanceRequired: true,
    maintenanceUrgency: "urgent",
    maintenanceText: "نعم — عاجل",
    resolutionSteps: [
      "تحقق من FreeRADIUS واتصال قاعدة البيانات.",
      "تأكد أن NAS يرسل Accounting بشكل صحيح.",
      "راجع آخر جلسة radacct — هل هناك جلسات نشطة؟",
    ],
  },
  backup_failed: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم",
    resolutionSteps: [
      "راجع سجل النسخ الاحتياطي من الإعدادات.",
      "تحقق من مساحة القرص وصلاحيات المجلد.",
      "أعد تشغيل النسخ اليدوي بعد إصلاح السبب.",
    ],
  },
  whatsapp_disconnected: {
    maintenanceRequired: true,
    maintenanceUrgency: "soon",
    maintenanceText: "نعم",
    resolutionSteps: [
      "افتح صفحة اتصال WhatsApp وأعد مسح QR.",
      "تأكد أن WAHA يعمل وأن الجلسة WORKING.",
    ],
  },
};

function severityLabelAr(severity: AlertSeverity): string {
  if (severity === "critical") return "حرج (Critical)";
  if (severity === "warning") return "تحذير (Warning)";
  return "معلومة (Info)";
}

export function getAlertGuidance(
  alertType: InfrastructureAlertType,
  severity: AlertSeverity
): AlertGuidance {
  const base = GUIDANCE[alertType] ?? DEFAULT_GUIDANCE;
  return {
    severityLabel: base.severityLabel ?? severityLabelAr(severity),
    maintenanceRequired: base.maintenanceRequired ?? DEFAULT_GUIDANCE.maintenanceRequired,
    maintenanceUrgency: base.maintenanceUrgency ?? DEFAULT_GUIDANCE.maintenanceUrgency,
    maintenanceText: base.maintenanceText ?? DEFAULT_GUIDANCE.maintenanceText,
    resolutionSteps: base.resolutionSteps ?? DEFAULT_GUIDANCE.resolutionSteps,
  };
}
