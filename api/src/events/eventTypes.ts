export const Events = {
  USER_CREATED: "user.created",
  USER_EXPIRED: "user.expired",
  INVOICE_PAID: "invoice.paid",
  WHATSAPP_SENT: "whatsapp.sent",
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
};
