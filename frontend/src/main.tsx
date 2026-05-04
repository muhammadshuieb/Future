import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/** Await before React: old SW could still intercept /assets/*.js until unregister finishes. */
async function clearLegacyPwa(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    /* ignore */
  }
  try {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    const stale = keys.filter((k) => /workbox|precache|google-fonts|pwa-cache/i.test(k));
    await Promise.all(stale.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
}

void clearLegacyPwa()
  .catch(() => {
    /* still mount UI if SW/cache cleanup fails */
  })
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  });
