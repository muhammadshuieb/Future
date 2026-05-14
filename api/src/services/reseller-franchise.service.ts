/** Commission from rule: percentage of base or fixed amount. */
export function calculateCommissionAmount(
  ruleType: "percent" | "fixed",
  value: number,
  baseAmount: number
): number {
  if (ruleType === "fixed") return Math.round(value * 100) / 100;
  return Math.round(baseAmount * (value / 100) * 100) / 100;
}

export function rejectRatio(authAccept: number, authReject: number): number {
  const t = authAccept + authReject;
  if (t <= 0) return 0;
  return authReject / t;
}
