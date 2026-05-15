const TOKEN_KEY = "fr_staff_token";
const USER_TOKEN = "fr_user_token";
const PORTAL_TOKEN_KEY = "fr_portal_token";
const RESELLER_TOKEN_KEY = "fr_reseller_token";

export function getApiBase() {
  const base = import.meta.env.VITE_PUBLIC_API_BASE;
  if (typeof base === "string" && base.trim()) return base.trim().replace(/\/+$/, "");
  return "";
}

export function getStaffToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStaffToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getUserToken() {
  return localStorage.getItem(USER_TOKEN);
}

export function setUserToken(t: string | null) {
  if (t) localStorage.setItem(USER_TOKEN, t);
  else localStorage.removeItem(USER_TOKEN);
}

export function getPortalToken() {
  return localStorage.getItem(PORTAL_TOKEN_KEY);
}

export function setPortalToken(t: string | null) {
  if (t) localStorage.setItem(PORTAL_TOKEN_KEY, t);
  else localStorage.removeItem(PORTAL_TOKEN_KEY);
}

export function getResellerToken() {
  return localStorage.getItem(RESELLER_TOKEN_KEY);
}

export function setResellerToken(t: string | null) {
  if (t) localStorage.setItem(RESELLER_TOKEN_KEY, t);
  else localStorage.removeItem(RESELLER_TOKEN_KEY);
}

export async function apiFetch(
  path: string,
  init: RequestInit & { skipAuth?: boolean } = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (!init.skipAuth) {
    const token = getStaffToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const { skipAuth: _s, ...rest } = init;
  return fetch(`${getApiBase()}${path}`, { ...rest, headers });
}

/** رسالة قابلة للعرض عند فشل الطلب (نص من الخادم أو رمز الحالة). */
export async function readApiError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return res.statusText || `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string; detail?: string; hints?: string[] };
      const hintBlock =
        Array.isArray(j.hints) && j.hints.length > 0 ? `\n\n${j.hints.join("\n")}` : "";
      if (j.detail) return `${j.error ?? "error"}: ${j.detail}${hintBlock}`;
      if (j.error) return j.error + hintBlock;
    } catch {
      return text.slice(0, 200);
    }
    return text.slice(0, 200);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export type MaintenanceUpdateSseEvent = {
  type: string;
  data: unknown;
  timestamp?: string;
};

/** Normalize error payloads from maintenance update SSE (string or { detail, error }). */
export function formatMaintenanceUpdateSseError(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.detail === "string" && o.detail.trim()) return o.detail;
    if (typeof o.error === "string" && o.error.trim()) return o.error;
  }
  return data == null ? "" : String(data);
}

/**
 * POST to the maintenance update run endpoint and parse `text/event-stream` chunks.
 * Browsers cannot send `Authorization: Bearer` with EventSource; this uses fetch instead.
 */
export async function streamMaintenanceUpdateRun(
  path: string,
  onEvent: (ev: MaintenanceUpdateSseEvent) => void,
  init?: { signal?: AbortSignal }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const token = getStaffToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers,
      body: "{}",
      credentials: "include",
      signal: init?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    return { ok: false, error: await readApiError(res) };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return { ok: false, error: "empty_response_body" };
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          const trimmed = line.replace(/\r$/, "");
          if (trimmed.startsWith("data:")) {
            dataLines.push(trimmed.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload) as MaintenanceUpdateSseEvent;
          onEvent(parsed);
        } catch {
          /* ignore non-JSON data lines */
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: true };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return { ok: true };
}

/** True when the server body is an Express default HTML page (e.g. missing route on an older API build). */
function looksLikeExpressHtmlErrorPage(raw: string): boolean {
  const s = raw.trim();
  if (/^<!doctype\s+html/i.test(s)) return true;
  if (/<html[\s>]/i.test(s) && /<\/html>/i.test(s)) return true;
  return false;
}

/** ترجمة أخطاء شائعة للواجهة العربية/الإنجليزية */
export function formatStaffApiError(status: number, raw: string, t: (key: string) => string): string {
  if (status === 401) return t("api.error_401");
  if (status === 403) return t("api.error_403");
  const low = raw.toLowerCase();
  if (looksLikeExpressHtmlErrorPage(raw) || /cannot\s+get\s+\//i.test(raw)) {
    return t("api.error_api_outdated");
  }
  if (low.includes("billing_tables_missing") || low.includes("invoices_table_missing")) {
    return t("api.error_billing_tables");
  }
  if (
    status >= 500 ||
    low.includes("db_error") ||
    low.includes("er_no_such_table") ||
    low.includes("doesn't exist")
  ) {
    return `${t("api.error_db")}\n${raw}`;
  }
  if (low.includes("invalid_body")) return t("api.error_invalid_body");
  if (low.includes("invalid_quota")) return t("api.error_quota");
  if (low.includes("allocation_pay_mismatch")) return t("api.error_allocation_mismatch");
  if (low.includes("allocation_exceeds_balance")) return t("api.error_allocation_exceeds");
  if (low.includes("allocation_currency_mismatch")) return t("api.error_allocation_currency");
  if (low.includes("invalid_allocations_defer")) return t("api.error_allocation_defer");
  if (low.includes("subscriber_nas_not_in_package_allowed_list")) {
    return t("api.error_subscriber_nas_not_in_package");
  }
  if (low.includes("manager_not_allowed_for_package")) {
    return t("api.error_manager_not_allowed_for_package");
  }
  if (low.includes("package_not_assigned_to_manager")) {
    return t("api.error_package_not_assigned_to_manager");
  }
  return raw || t("api.error_generic");
}

export async function userApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getUserToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}

export async function portalApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getPortalToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}

export async function resellerPortalApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getResellerToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}
