/** Same-origin path for uploaded emoji; avoids broken preview when PUBLIC_APP_URL ≠ browser host. */
export function whatsAppEmojiPreviewSrc(preview?: string | null, stored?: string | null): string {
  const u = String(preview ?? stored ?? "").trim();
  if (!u) return "";
  if (u.startsWith("/api/whatsapp/assets/")) return u;
  try {
    const parsed = new URL(u, window.location.origin);
    if (parsed.pathname.startsWith("/api/whatsapp/assets/")) return parsed.pathname;
  } catch {
    /* ignore */
  }
  return u;
}
