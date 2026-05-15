import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const ASSET_PATH_RE = /\/api\/whatsapp\/assets\/([0-9a-f-]{36})\/emoji\.(\w+)/i;

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

/** Parse stored path or URL into tenant + extension when it is our asset route. */
export function parseEmojiAssetPath(stored: string | null | undefined): { tenantId: string; ext: string } | null {
  const t = String(stored ?? "").trim();
  if (!t) return null;
  const m = t.match(ASSET_PATH_RE);
  if (!m) return null;
  return { tenantId: m[1], ext: m[2] };
}

/**
 * Browser preview URL. Prefer same-origin relative path so it works behind any public IP/domain
 * without relying on PUBLIC_APP_URL.
 */
export function resolveEmojiPreviewUrl(stored: string | null | undefined): string {
  const t = String(stored ?? "").trim();
  if (!t) return "";
  if (t.startsWith("/api/whatsapp/assets/")) return t;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    const parsed = parseEmojiAssetPath(t);
    if (parsed) return whatsAppEmojiRelPath(parsed.tenantId, parsed.ext);
    return t;
  }
  const p = t.startsWith("/") ? t : `/${t}`;
  if (p.startsWith("/api/whatsapp/assets/")) return p;
  const base = config.publicAppUrl.replace(/\/+$/, "");
  return `${base}${p}`;
}

/** URL the admin UI can use to preview the stored emoji (browser-facing). */
export function resolveEmojiPublicUrl(stored: string | null | undefined): string {
  return resolveEmojiPreviewUrl(stored);
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

export function emojiMimetypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return "image/png";
}

/** Load emoji bytes from disk when stored value points at our asset route. */
export async function readEmojiAssetFromStored(
  stored: string | null | undefined
): Promise<{ buffer: Buffer; mimetype: string; filename: string } | null> {
  const parsed = parseEmojiAssetPath(stored);
  if (!parsed) return null;
  const filePath = resolveEmojiAssetFile(parsed.tenantId, parsed.ext);
  if (!filePath) return null;
  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.length === 0) return null;
    const ext = parsed.ext === "jpeg" ? "jpg" : parsed.ext;
    return {
      buffer,
      mimetype: emojiMimetypeFromExt(ext),
      filename: `emoji.${ext}`,
    };
  } catch {
    return null;
  }
}

/**
 * Load emoji for WAHA sendImage: local disk (API container) or HTTP fetch from API (worker container).
 */
export async function loadEmojiFileForWahaSend(
  stored: string | null | undefined
): Promise<{ mimetype: string; filename: string; data: string } | null> {
  const t = String(stored ?? "").trim();
  if (!t) return null;

  let file = await readEmojiAssetFromStored(t);
  if (!file) {
    const url = resolveWahaEmojiFetchUrl(t);
    if (!url) return null;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length === 0) return null;
      const parsed = parseEmojiAssetPath(t);
      const ext = parsed?.ext === "jpeg" ? "jpg" : parsed?.ext ?? "png";
      file = {
        buffer,
        mimetype: emojiMimetypeFromExt(ext),
        filename: `emoji.${ext}`,
      };
    } catch {
      return null;
    }
  }

  return {
    mimetype: file.mimetype,
    filename: file.filename,
    data: file.buffer.toString("base64"),
  };
}
