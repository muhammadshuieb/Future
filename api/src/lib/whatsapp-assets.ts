import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const ASSETS_ROOT =
  process.env.WHATSAPP_ASSETS_DIR?.trim() || path.join(process.cwd(), "data", "whatsapp-assets");

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function whatsAppAssetDir(tenantId: string): string {
  return path.join(ASSETS_ROOT, tenantId);
}

export function whatsAppEmojiRelPath(tenantId: string, ext: string): string {
  return `/api/whatsapp/assets/${tenantId}/emoji.${ext}`;
}

/** URL the admin UI can use to preview the stored emoji (browser-facing). */
export function resolveEmojiPublicUrl(stored: string | null | undefined): string {
  const t = String(stored ?? "").trim();
  if (!t) return "";
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const base = config.publicAppUrl.replace(/\/+$/, "");
  const p = t.startsWith("/") ? t : `/${t}`;
  return `${base}${p}`;
}

/** URL WAHA uses to download the image (must be reachable from the WAHA container). */
export function resolveWahaEmojiFetchUrl(stored: string | null | undefined): string {
  const t = String(stored ?? "").trim();
  if (!t) return "";
  const internal = (
    process.env.WAHA_EMOJI_FETCH_BASE_URL ??
    process.env.WAHA_INTERNAL_URL ??
    "http://api:3000"
  )
    .trim()
    .replace(/\/+$/, "");

  if (t.startsWith("http://") || t.startsWith("https://")) {
    try {
      const u = new URL(t);
      if (u.pathname.includes("/api/whatsapp/assets/")) {
        return `${internal}${u.pathname}`;
      }
    } catch {
      return t;
    }
    return t;
  }
  const pathPart = t.startsWith("/") ? t : `/${t}`;
  return `${internal}${pathPart}`;
}

export async function saveWhatsAppEmojiImage(
  tenantId: string,
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  const ext = MIME_TO_EXT[mimetype];
  if (!ext) throw new Error("invalid_image_type");

  const dir = whatsAppAssetDir(tenantId);
  await fs.mkdir(dir, { recursive: true });

  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    if (name.startsWith("emoji.")) {
      await fs.unlink(path.join(dir, name)).catch(() => undefined);
    }
  }

  const filename = `emoji.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return whatsAppEmojiRelPath(tenantId, ext);
}

export function resolveEmojiAssetFile(tenantId: string, ext: string): string | null {
  const allowed = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!allowed.has(safeExt)) return null;
  const normalized = safeExt === "jpeg" ? "jpg" : safeExt;
  return path.join(whatsAppAssetDir(tenantId), `emoji.${normalized}`);
}
