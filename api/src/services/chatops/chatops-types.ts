export type ChatOpsChannel = "whatsapp" | "telegram";

export type ChatOpsCommandType =
  | "help"
  | "subscriber_details"
  | "subscriber_status"
  | "subscriber_sessions"
  | "subscriber_invoice"
  | "create_subscriber"
  | "renew_subscriber"
  | "collect_payment"
  | "disconnect_user"
  | "disconnect_all_sessions"
  | "online_count"
  | "servers_status"
  | "current_alerts"
  | "manager_wallet"
  | "daily_report"
  | "send_invoice"
  | "print_prepaid_cards"
  | "nas_status"
  | "nas_metric"
  | "confirm"
  | "unknown";

export type ParsedChatOpsCommand = {
  type: ChatOpsCommandType;
  args: Record<string, string | number | boolean>;
  target?: string;
  requiresConfirmation: boolean;
  permission: string | null;
};

export type ChatOpsStaffSession = {
  tenantId: string;
  staffUserId: string;
  staffName: string;
  role: string;
  permissions: Record<string, boolean>;
  channel: ChatOpsChannel;
  externalSenderId: string;
  phoneNumber: string | null;
};

export type ChatOpsInboundMessage = {
  tenantId: string;
  channel: ChatOpsChannel;
  externalSenderId: string;
  phoneNumber: string | null;
  displayName: string | null;
  text: string;
  isGroup: boolean;
};

export type ChatOpsRouteResult = {
  replyText: string;
  status: "executed" | "denied" | "pending_confirmation" | "failed" | "ignored";
  commandType?: ChatOpsCommandType;
  targetEntity?: string;
  error?: string;
};
