/** @typedef {{ id: string; email: string; role: string; tenantId: string }} User */

const STORAGE_KEY = "fr_token";
const STORAGE_USER = "fr_user";
const STORAGE_BASE = "fr_api_base";

/** @returns {string} */
export function getApiBase() {
  return localStorage.getItem(STORAGE_BASE) || "http://localhost:3000";
}

/** @param {string} base */
export function setApiBase(base) {
  localStorage.setItem(STORAGE_BASE, base.replace(/\/$/, ""));
}

/** @returns {string | null} */
export function getToken() {
  return localStorage.getItem(STORAGE_KEY);
}

/** @param {string | null} token */
export function setToken(token) {
  if (token) localStorage.setItem(STORAGE_KEY, token);
  else localStorage.removeItem(STORAGE_KEY);
}

/** @returns {User | null} */
export function getUser() {
  try {
    const j = localStorage.getItem(STORAGE_USER);
    return j ? JSON.parse(j) : null;
  } catch {
    return null;
  }
}

/** @param {User | null} user */
export function setUser(user) {
  if (user) localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_USER);
}

export function clearSession() {
  setToken(null);
  setUser(null);
}

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 */
export async function api(path, opts = {}) {
  const base = getApiBase();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  /** @type {RequestInit} */
  const init = {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
    },
  };
  const t = getToken();
  if (t) init.headers["Authorization"] = `Bearer ${t}`;
  if (opts.body !== undefined && opts.method !== "GET" && opts.method !== "HEAD") {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  /** @type {unknown} */
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    // @ts-ignore
    err.status = res.status;
    // @ts-ignore
    err.data = data;
    throw err;
  }
  return data;
}
