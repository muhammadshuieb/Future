import type { Request } from "express";
import { config } from "../config.js";

/**
 * Public origin of the API as seen by the browser (reverse-proxy safe).
 */
export function inferApiPublicOrigin(req: Pick<Request, "protocol" | "get">): string {
  const xfProto = req.get("x-forwarded-proto");
  const proto = (xfProto?.split(",")[0]?.trim() || req.protocol || "http").replace(/:$/, "");
  const xfHost = req.get("x-forwarded-host");
  const host = xfHost?.split(",")[0]?.trim() || req.get("host");
  if (!host) return config.publicAppUrl.replace(/\/+$/, "");
  return `${proto}://${host}`;
}

function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function allowedCorsOrigins(): string[] {
  if (config.corsOrigins === "all") return [];
  return config.corsOrigins;
}

/**
 * After Google OAuth, redirect the browser to this panel origin (must be allowlisted).
 */
export function inferReturnFrontendOrigin(req: Pick<Request, "get">, apiOrigin: string): string {
  const fromReferer = normalizeOrigin(req.get("referer") ?? "");
  const fromOrigin = normalizeOrigin(req.get("origin") ?? "");
  const fromCfg = normalizeOrigin(config.publicFrontendUrl) ?? config.publicFrontendUrl.replace(/\/+$/, "");
  for (const candidate of [fromReferer, fromOrigin, fromCfg]) {
    if (candidate && isAllowedReturnOrigin(candidate, apiOrigin)) return candidate;
  }
  return fromCfg;
}

export function isAllowedReturnOrigin(returnOrigin: string, apiOrigin: string): boolean {
  const o = normalizeOrigin(returnOrigin);
  if (!o) return false;
  const cfgFront = normalizeOrigin(config.publicFrontendUrl);
  if (cfgFront && o === cfgFront) return true;
  for (const c of allowedCorsOrigins()) {
    const co = normalizeOrigin(c);
    if (co && o === co) return true;
  }
  try {
    const api = new URL(apiOrigin);
    const ro = new URL(o);
    if (ro.hostname === api.hostname) return true;
    if (ro.hostname === "localhost" || ro.hostname === "127.0.0.1") return true;
  } catch {
    return false;
  }
  return false;
}
