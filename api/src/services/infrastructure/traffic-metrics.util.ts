import type { RouterHealthSnapshot } from "./infrastructure-types.js";

/** Cumulative interface byte counters from RouterOS (stored in traffic_rx_bps / traffic_tx_bps columns). */
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

export function formatBytesAsMbGb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatMbValue(mb: number | null | undefined): string {
  if (mb == null || !Number.isFinite(mb)) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb} MB`;
}

/** Traffic section for Telegram — period delta when available, else cumulative counters. */
export function formatTrafficSection(snap: RouterHealthSnapshot): string[] {
  const iface = snap.traffic_monitor_interface?.trim();
  const title = iface ? `📡 الترافيك · ${iface}` : "📡 الترافيك";

  const hasPeriod =
    snap.traffic_rx_mb != null ||
    snap.traffic_tx_mb != null ||
    (snap.traffic_rx_mb === 0 && snap.traffic_tx_mb === 0);

  if (hasPeriod) {
    return [
      title,
      `   ⬇️ تحميل: ${formatMbValue(snap.traffic_rx_mb)}`,
      `   ⬆️ رفع: ${formatMbValue(snap.traffic_tx_mb)}`,
      `   ⏱ منذ آخر فحص`,
    ];
  }

  const rxBytes = snap.traffic_rx_bps;
  const txBytes = snap.traffic_tx_bps;
  if (rxBytes != null || txBytes != null) {
    return [
      title,
      `   ⬇️ تحميل (إجمالي): ${formatBytesAsMbGb(rxBytes)}`,
      `   ⬆️ رفع (إجمالي): ${formatBytesAsMbGb(txBytes)}`,
      `   ℹ️ الفرق بين الفحوصات يظهر من التقرير التالي`,
    ];
  }

  return [title, "   ⬇️ تحميل: —", "   ⬆️ رفع: —"];
}

/** @deprecated use formatTrafficSection */
export function formatTrafficMbLine(
  rxMb: number | null | undefined,
  txMb: number | null | undefined,
  ifaceLabel?: string | null
): string {
  const suffix = ifaceLabel ? ` (${ifaceLabel})` : "";
  const down = rxMb != null && Number.isFinite(rxMb) ? `${rxMb} MB` : "—";
  const up = txMb != null && Number.isFinite(txMb) ? `${txMb} MB` : "—";
  return `⬇️ تحميل${suffix}: ${down} | ⬆️ رفع: ${up}`;
}
