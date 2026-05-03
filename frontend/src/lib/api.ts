const TOKEN_KEY = "fr_staff_token";
const USER_TOKEN = "fr_user_token";

export function getApiBase() {
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

/** ترجمة أخطاء شائعة للواجهة العربية/الإنجليزية */
export function formatStaffApiError(status: number, raw: string, t: (key: string) => string): string {
  if (status === 401) return t("api.error_401");
  if (status === 403) return t("api.error_403");
  const low = raw.toLowerCase();
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
