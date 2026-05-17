import type { RouterHealthSnapshot } from "./infrastructure-types.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bytes transferred over elapsed seconds → megabits per second. */
export function bytesDeltaToMbps(
  rxDelta: number,
  txDelta: number,
  elapsedSec: number
): { rxMbps: number; txMbps: number } {
  if (elapsedSec <= 0 || !Number.isFinite(elapsedSec)) {
    return { rxMbps: 0, txMbps: 0 };
  }
  const toMbps = (delta: number) =>
    Math.max(0, Math.round(((Math.max(0, delta) * 8) / elapsedSec / 1_000_000) * 100) / 100);
  return { rxMbps: toMbps(rxDelta), txMbps: toMbps(txDelta) };
}

/** @deprecated interval MB between polls — not used in Telegram instant reports */
export function computeTrafficPeriodMb(
  currentRxBytes: number,
  currentTxBytes: number,
  prevRxBytes: number | null | undefined,
  prevTxBytes: number | null | undefined,
  prevSyncAt: string | null | undefined,
  nowMs = Date.now()
): { rxMb: number | null; txMb: number | null } {
  if (prevRxBytes == null || prevTxBytes == null || !prevSyncAt) {
    return { rxMb: null, txMb: null };
  }
  const elapsedSec = (nowMs - new Date(prevSyncAt).getTime()) / 1000;
  if (!Number.isFinite(elapsedSec) || elapsedSec < 30) {
    return { rxMb: null, txMb: null };
  }
  const rxDelta = currentRxBytes - prevRxBytes;
  const txDelta = currentTxBytes - prevTxBytes;
  if (rxDelta < 0 || txDelta < 0) {
    return { rxMb: null, txMb: null };
  }
  const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 100) / 100;
  return { rxMb: toMb(rxDelta), txMb: toMb(txDelta) };
}

function formatMbps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)} Gbps`;
  return `${v} Mbps`;
}

/** Instant line speed at message time (not cumulative). */
export function formatTrafficSection(snap: RouterHealthSnapshot): string[] {
  const iface = snap.traffic_monitor_interface?.trim();
  const title = iface ? `📡 الترافيك · ${iface}` : "📡 الترافيك";

  if (snap.traffic_rx_mbps != null || snap.traffic_tx_mbps != null) {
    return [
      title,
      `   ⬇️ السحب الآن: ${formatMbps(snap.traffic_rx_mbps)}`,
      `   ⬆️ الرفع الآن: ${formatMbps(snap.traffic_tx_mbps)}`,
    ];
  }

  return [title, "   ⬇️ السحب الآن: —", "   ⬆️ الرفع الآن: —"];
}
