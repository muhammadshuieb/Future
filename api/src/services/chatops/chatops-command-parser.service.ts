import type { ParsedChatOpsCommand, ChatOpsCommandType } from "./chatops-types.js";

function normalizeArabicText(raw: string): string {
  return raw
    .trim()
    .replace(/[؟?!.,،]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function extractKeyValuePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /(username|user|اسم|باسم|password|كلمة|السر|phone|هاتف|package|باقة|مبلغ|amount)\s*[=:]\s*(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]!.toLowerCase()] = m[2]!;
  }
  return out;
}

function pickTarget(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

const CONFIRM_RE = /^تأكيد\s+(\d{4,6})$/i;

export function parseChatOpsCommand(rawMessage: string): ParsedChatOpsCommand {
  const raw = rawMessage.trim();
  const text = normalizeArabicText(raw);

  const confirmMatch = raw.match(CONFIRM_RE) ?? text.match(CONFIRM_RE);
  if (confirmMatch) {
    return {
      type: "confirm",
      args: { code: confirmMatch[1]! },
      requiresConfirmation: false,
      permission: null,
    };
  }

  const kv = extractKeyValuePairs(raw);

  if (/^(مساعده|help|الاوامر|أوامر)$/.test(text)) {
    return { type: "help", args: {}, requiresConfirmation: false, permission: null };
  }

  if (/^(كم عدد المتصلين|المتصلين الان|المتصلين الآن|online)/.test(text)) {
    return {
      type: "online_count",
      args: {},
      requiresConfirmation: false,
      permission: "chatops:view_subscriber",
    };
  }

  if (/^(حاله السيرفرات|حالة السيرفرات|السيرفرات)$/.test(text)) {
    return {
      type: "servers_status",
      args: {},
      requiresConfirmation: false,
      permission: "chatops:view_monitoring",
    };
  }

  if (/^(التنبيهات|التنبيهات الحاليه|التنبيهات الحالية)$/.test(text)) {
    return {
      type: "current_alerts",
      args: {},
      requiresConfirmation: false,
      permission: "chatops:view_monitoring",
    };
  }

  if (/^(تقرير اليوم|تقرير اليومي)$/.test(text)) {
    return {
      type: "daily_report",
      args: {},
      requiresConfirmation: false,
      permission: "chatops:view_finance",
    };
  }

  const targetDefault = pickTarget(text, [
    /(?:المشترك|مشترك)\s+(\S+)$/i,
    /\s+(\S+)$/,
  ]);

  if (/^(تفاصيل|تفاصيل المشترك)/.test(text)) {
    const target = pickTarget(text, [/تفاصيل(?:\s+المشترك)?\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "subscriber_details",
      args: {},
      target,
      requiresConfirmation: false,
      permission: "chatops:view_subscriber",
    };
  }

  if (/^(حاله|حالة)(?:\s+المشترك)?/.test(text) && !/السيرفرات/.test(text)) {
    const target = pickTarget(text, [/حاله(?:\s+المشترك)?\s+(\S+)/i, /حالة(?:\s+المشترك)?\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "subscriber_status",
      args: {},
      target,
      requiresConfirmation: false,
      permission: "chatops:view_subscriber",
    };
  }

  if (/^(جلسات|جلسات المشترك)/.test(text)) {
    const target = pickTarget(text, [/جلسات(?:\s+المشترك)?\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "subscriber_sessions",
      args: {},
      target,
      requiresConfirmation: false,
      permission: "chatops:view_subscriber",
    };
  }

  if (/^(فاتوره|فاتورة|ارسل فاتوره|أرسل فاتورة)/.test(text)) {
    const target =
      pickTarget(text, [/فاتوره\s+(\S+)/i, /فاتورة\s+(\S+)/i, /ارسل فاتوره\s+(\S+)/i]) ?? targetDefault;
    const sendOnly = /ارسل|أرسل/.test(text);
    return {
      type: sendOnly ? "send_invoice" : "subscriber_invoice",
      args: {},
      target,
      requiresConfirmation: sendOnly,
      permission: sendOnly ? "chatops:view_finance" : "chatops:view_subscriber",
    };
  }

  if (/^(رصيد المدير|رصيد مدير)/.test(text)) {
    const target = pickTarget(text, [/رصيد(?:\s+المدير)?\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "manager_wallet",
      args: {},
      target,
      requiresConfirmation: false,
      permission: "chatops:view_finance",
    };
  }

  if (/^(افصل كل جلسات|افصل كل)/.test(text)) {
    const target = pickTarget(text, [/افصل كل(?:\s+جلسات)?\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "disconnect_all_sessions",
      args: {},
      target,
      requiresConfirmation: true,
      permission: "chatops:disconnect_user",
    };
  }

  if (/^افصل/.test(text)) {
    const target = pickTarget(text, [/افصل\s+(\S+)/i]) ?? targetDefault;
    return {
      type: "disconnect_user",
      args: {},
      target,
      requiresConfirmation: true,
      permission: "chatops:disconnect_user",
    };
  }

  if (/^(جدد|تجديد)/.test(text)) {
    const target = pickTarget(text, [/جدد\s+(\S+)/i]) ?? targetDefault;
    const periodMatch = text.match(/(شهر|اسبوع|سنه|سنة|\d{4}-\d{2}-\d{2})/);
    return {
      type: "renew_subscriber",
      args: { period: periodMatch?.[1] ?? "شهر" },
      target,
      requiresConfirmation: true,
      permission: "chatops:renew_subscriber",
    };
  }

  if (/^(ادفع|دفع فاتوره|دفع فاتورة)/.test(text)) {
    const target = pickTarget(text, [/ادفع(?:\s+فاتوره)?\s+(\S+)/i]) ?? targetDefault;
    const amountMatch = text.match(/مبلغ\s+(\d+(?:\.\d+)?)/);
    return {
      type: "collect_payment",
      args: { amount: amountMatch?.[1] ?? "" },
      target,
      requiresConfirmation: true,
      permission: "chatops:view_finance",
    };
  }

  if (/^(انشئ مشترك|أنشئ مشترك|اضف مشترك|أضف مشترك)/.test(text)) {
    const username =
      kv.username ?? kv.user ?? kv["اسم"] ?? kv["باسم"] ?? pickTarget(text, [/باسم\s+(\S+)/i]);
    const password = kv.password ?? kv["كلمة"] ?? kv["السر"];
    const phone = kv.phone ?? kv["هاتف"];
    const pkg = kv.package ?? kv["باقة"];
    return {
      type: "create_subscriber",
      args: {
        username: username ?? "",
        password: password ?? "",
        phone: phone ?? "",
        package: pkg ?? "",
      },
      requiresConfirmation: true,
      permission: "chatops:create_subscriber",
    };
  }

  const prepaidMatch = text.match(/(?:انشئ|أنشئ|اطبع|أطبع)\s+(\d+)\s+(?:كرت|كروت|كارت)\s+(?:باقه|باقة)\s+(\S+)/);
  if (prepaidMatch) {
    return {
      type: "print_prepaid_cards",
      args: { quantity: prepaidMatch[1]!, package: prepaidMatch[2]! },
      requiresConfirmation: true,
      permission: "chatops:print_prepaid_cards",
    };
  }

  const nasMetricMatch = text.match(/^(حراره|حرارة|المعالج|المعالج|الرام|ram|cpu)\s+(\S+)/i);
  if (nasMetricMatch) {
    return {
      type: "nas_metric",
      args: { metric: nasMetricMatch[1]! },
      target: nasMetricMatch[2],
      requiresConfirmation: false,
      permission: "chatops:view_monitoring",
    };
  }

  if (/^حاله\s+\S+/i.test(text) && /nas|راوتر/i.test(text)) {
    const target = pickTarget(text, [/حاله\s+(\S+)/i]);
    return {
      type: "nas_status",
      args: {},
      target,
      requiresConfirmation: false,
      permission: "chatops:view_monitoring",
    };
  }

  return {
    type: "unknown",
    args: { raw: text },
    requiresConfirmation: false,
    permission: null,
  };
}

export function buildHelpText(): string {
  return [
    "أوامر ChatOps (أمثلة):",
    "• تفاصيل المشترك ali",
    "• حالة ali",
    "• جلسات ali",
    "• افصل ali",
    "• جدد ali شهر",
    "• أنشئ مشترك username=ali password=123456 phone=09xxx package=10M",
    "• كم عدد المتصلين الآن؟",
    "• حالة السيرفرات",
    "• رصيد المدير محمد",
    "• تقرير اليوم",
    "• أرسل فاتورة ahmad",
    "• اطبع 10 كرت باقة 5M",
    "",
    "للأوامر الخطرة: اكتب «تأكيد CODE» بعد طلب التأكيد.",
  ].join("\n");
}
