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

export function formatTrafficMbLine(
  rxMb: number | null | undefined,
  txMb: number | null | undefined,
  ifaceLabel?: string | null
): string {
  const suffix = ifaceLabel ? ` (${ifaceLabel})` : "";
  const down =
    rxMb != null && Number.isFinite(rxMb) ? `${rxMb} MB` : "—";
  const up =
    txMb != null && Number.isFinite(txMb) ? `${txMb} MB` : "—";
  return `⬇️ تحميل${suffix}: ${down} | ⬆️ رفع: ${up}`;
}
