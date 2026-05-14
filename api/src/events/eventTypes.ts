export const Events = {
  USER_CREATED: "user.created",
  USER_EXPIRED: "user.expired",
  USER_QUOTA_SUSPENDED: "user.quota_suspended",
  INVOICE_PAID: "invoice.paid",
  WHATSAPP_SENT: "whatsapp.sent",
  QOE_ALERT: "qoe.alert",
  RADIUS_MONITOR_SNAPSHOT: "radius_monitor.snapshot",
  RADIUS_MONITOR_ALERT: "radius_monitor.alert",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

export type EventPayloadByName = {
  [Events.USER_CREATED]: {
    tenantId: string;
    subscriberId: string;
    username: string;
  };
  [Events.USER_EXPIRED]: {
    tenantId: string;
    subscriberId: string;
    username: string;
    expirationDate: string | null;
  };
  [Events.USER_QUOTA_SUSPENDED]: {
    tenantId: string;
    subscriberId: string;
    username: string;
    usedBytes: string;
    quotaBytes: string;
  };
  [Events.INVOICE_PAID]: {
    tenantId: string;
    invoiceId: string;
    subscriberId: string;
    invoiceNo: string;
    amount: number;
    currency: string;
    paidAt: string;
  };
  [Events.WHATSAPP_SENT]: {
    tenantId: string;
    subscriberId: string | null;
    phone: string;
    templateKey: string | null;
    status: "sent" | "failed";
    providerMessageId: string | null;
    errorMessage: string | null;
  };
  [Events.QOE_ALERT]: { tenantId: string; subscriber_id?: string; score?: number };
  [Events.RADIUS_MONITOR_SNAPSHOT]: {
    tenantId: string;
    bucket_start?: string;
    auth_accept?: number;
    auth_reject?: number;
    active_sessions?: number;
  };
  [Events.RADIUS_MONITOR_ALERT]: { tenantId: string; reject_ratio?: number };
};
