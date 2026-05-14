/** Pure QoE score 0–100 from normalized inputs (0 = best, high = bad for loss/jitter etc.). */
export type QoeInputs = {
  packetLossPct: number;
  jitterMs: number;
  latencyMs: number;
  reconnectsPerDay: number;
  failedAuthPerDay: number;
  avgSessionSec: number;
  bandwidthSaturationPct: number;
};

export type QoeResult = {
  score: number;
  status: "green" | "yellow" | "red";
  reasons: string[];
  recommendations: string[];
};

export function computeQoeScore(input: QoeInputs): QoeResult {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let penalty = 0;

  if (input.packetLossPct > 0.5) {
    penalty += Math.min(35, input.packetLossPct * 6);
    reasons.push(`Packet loss ~${input.packetLossPct.toFixed(2)}%`);
    recommendations.push("Check last-mile RF or cable plant; inspect NAS uplink errors.");
  } else if (input.packetLossPct > 0.05) {
    penalty += input.packetLossPct * 4;
    reasons.push(`Elevated packet loss ~${input.packetLossPct.toFixed(2)}%`);
  }

  if (input.jitterMs > 40) {
    penalty += Math.min(25, (input.jitterMs - 40) / 3);
    reasons.push(`High jitter ~${input.jitterMs.toFixed(0)} ms`);
    recommendations.push("Stabilize CPE or reduce contention on the sector.");
  }

  if (input.latencyMs > 120) {
    penalty += Math.min(20, (input.latencyMs - 120) / 15);
    reasons.push(`High latency ~${input.latencyMs.toFixed(0)} ms`);
  }

  if (input.reconnectsPerDay > 8) {
    penalty += Math.min(25, (input.reconnectsPerDay - 8) * 2);
    reasons.push(`Frequent reconnects (${input.reconnectsPerDay}/day)`);
    recommendations.push("Review RADIUS session timeouts, PPP keepalive, and power stability.");
  }

  if (input.failedAuthPerDay > 5) {
    penalty += Math.min(15, (input.failedAuthPerDay - 5) * 2);
    reasons.push(`Repeated auth failures (${input.failedAuthPerDay}/day)`);
    recommendations.push("Verify password sync and CPE credentials.");
  }

  if (input.avgSessionSec > 0 && input.avgSessionSec < 120 && input.reconnectsPerDay > 3) {
    penalty += 12;
    reasons.push("Very short average sessions with multiple reconnects");
    recommendations.push("Investigate intermittent link or aggressive idle disconnect.");
  }

  if (input.bandwidthSaturationPct > 85) {
    penalty += Math.min(18, (input.bandwidthSaturationPct - 85));
    reasons.push(`Bandwidth saturation ~${input.bandwidthSaturationPct.toFixed(0)}%`);
    recommendations.push("Offer upgrade or apply fair-queue shaping on the package.");
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let status: QoeResult["status"] = "green";
  if (score < 60) status = "red";
  else if (score < 80) status = "yellow";

  if (recommendations.length === 0 && status !== "green") {
    recommendations.push("Collect NAS port errors and run a controlled CPE reboot test.");
  }

  return { score, status, reasons, recommendations };
}

export function nasOverloadFromPoorCounts(activeSessions: number, poorSubs: number): boolean {
  if (activeSessions < 20) return poorSubs >= 8;
  const ratio = poorSubs / Math.max(1, activeSessions);
  return ratio >= 0.25 && poorSubs >= 5;
}
