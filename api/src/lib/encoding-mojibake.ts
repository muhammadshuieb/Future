/**
 * Production-safe heuristics for Arabic mojibake (UTF-8 mis-decoded as Latin-1 / Windows-1252,
 * double-encoded UTF-8, and common smart-quote corruption). Not all damage is recoverable.
 */

/** Mojibake fragments typical when UTF-8 Arabic was read as single-byte encoding. */
export const MOJIBAKE_FRAGMENT_RE =
  /ط§|ط¨|طª|ط«|ط¬|ط­|ط®|ط¯|ط°|ط±|ط²|ط³|ط´|طµ|ط¶|ط·|ط¸|ط¹|ط؛|ظپ|ظ‚|ظƒ|ظ„|ظ…|ظ†|ظ‡|ظˆ|ظ‰|ظٹ|ظ€|آ«|آ»|â€|âœ|â|â€“|â€”|â€œ|â€˜|â€™|Ã—|Ã©|Ã¨|Ã¢|Ã®|Ã´|Ã»|Ã§|Ã±|Ø§|Ù…|Ù„|Ø|Ù|Ú|Û|Ä/g;

/** Looks like UTF-8 multi-byte lead bytes misinterpreted (common in double-encoding). */
export const MOJIBAKE_BYTE_LEAD_RE = /[\xC2-\xFD][\x80-\xBF]/g;

export function countArabicLetters(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!;
    if (c >= 0x0600 && c <= 0x06ff) n++;
    if (c > 0xffff) i++;
  }
  return n;
}

export function countMojibakeSignals(s: string): number {
  if (!s) return 0;
  MOJIBAKE_FRAGMENT_RE.lastIndex = 0;
  let hits = 0;
  let m: RegExpExecArray | null;
  while ((m = MOJIBAKE_FRAGMENT_RE.exec(s)) !== null) hits++;
  return hits;
}

export function countSmartQuoteArtifacts(s: string): number {
  if (!s) return 0;
  let n = 0;
  if (s.includes("â€")) n += 2;
  if (s.includes("â€œ") || s.includes("â€˜") || s.includes("â€™")) n += 1;
  if (s.includes("âœ") || s.includes("â")) n += 1;
  return n;
}

/**
 * Interprets the current JS string code units as Latin-1 bytes, then decodes those bytes as UTF-8.
 * Fixes the classic "UTF-8 stored via latin1 connection" case.
 */
export function repairLatin1BytesAsUtf8(s: string): string {
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

/** Apply latin1→utf8 up to `depth` times only while each step reduces mojibake or adds Arabic letters. */
export function repairChainedLatin1Utf8(s: string, depth = 2): string {
  let cur = s;
  for (let i = 0; i < depth; i++) {
    const next = repairLatin1BytesAsUtf8(cur);
    if (next === cur) break;
    const badBefore = countMojibakeSignals(cur) + countSmartQuoteArtifacts(cur);
    const badAfter = countMojibakeSignals(next) + countSmartQuoteArtifacts(next);
    const arBefore = countArabicLetters(cur);
    const arAfter = countArabicLetters(next);
    if (badAfter >= badBefore && arAfter <= arBefore) break;
    cur = next;
  }
  return cur;
}

const SMART_QUOTE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€”/g, "\u2014"],
  [/â€“/g, "\u2013"],
  [/â€œ/g, "\u201c"],
  [/â€/g, "\u201d"],
  [/â€˜/g, "\u2018"],
  [/â€™/g, "\u2019"],
  [/â€¦/g, "\u2026"],
  [/â€¢/g, "\u2022"],
];

export function repairSmartQuoteMojibake(s: string): string {
  let out = s;
  for (const [re, rep] of SMART_QUOTE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  out = out.replace(/âœ“/g, "\u2713").replace(/âœ—/g, "\u2717");
  return out;
}

export type EncodingIssueKind =
  | "mojibake_signature"
  | "smart_quote_artifact"
  | "double_encoding_suspected"
  | "low_confidence_suspect";

export type RepairStrategy = "latin1_as_utf8" | "chained_latin1_utf8" | "smart_quotes" | "composite";

export type EncodingAnalysis = {
  original: string;
  issueKinds: EncodingIssueKind[];
  /** 0–1 higher = more likely corrupted Arabic / mojibake */
  confidence: number;
  bestRepair: { strategy: RepairStrategy; text: string; confidenceAfter: number } | null;
};

function scoreLikelyGoodArabic(s: string): number {
  const ar = countArabicLetters(s);
  const bad = countMojibakeSignals(s) + countSmartQuoteArtifacts(s);
  const len = Math.max(s.length, 1);
  const ratio = ar / len;
  const penalty = Math.min(1, bad / Math.max(12, len * 0.03));
  return Math.max(0, Math.min(1, ratio * 2.2 - penalty * 1.1));
}

function pickBestRepair(original: string): { strategy: RepairStrategy; text: string; confidenceAfter: number } | null {
  const candidates: Array<{ strategy: RepairStrategy; text: string }> = [];

  const sq = repairSmartQuoteMojibake(original);
  if (sq !== original) candidates.push({ strategy: "smart_quotes", text: sq });

  const l1 = repairLatin1BytesAsUtf8(original);
  if (l1 !== original) candidates.push({ strategy: "latin1_as_utf8", text: l1 });

  const chain = repairChainedLatin1Utf8(original, 3);
  if (chain !== original && chain !== l1) candidates.push({ strategy: "chained_latin1_utf8", text: chain });

  const composite = repairChainedLatin1Utf8(repairSmartQuoteMojibake(original), 2);
  if (composite !== original) candidates.push({ strategy: "composite", text: composite });

  let best: { strategy: RepairStrategy; text: string; confidenceAfter: number } | null = null;
  for (const c of candidates) {
    const score = scoreLikelyGoodArabic(c.text);
    const origScore = scoreLikelyGoodArabic(original);
    if (score <= origScore + 0.04) continue;
    if (!best || score > best.confidenceAfter) {
      best = { strategy: c.strategy, text: c.text, confidenceAfter: score };
    }
  }
  return best;
}

const MIN_LEN = 3;

/**
 * Analyse a single text cell. Short ASCII-only strings return hasIssue false.
 */
export function analyzeTextCell(value: string | null | undefined): EncodingAnalysis | null {
  if (value === null || value === undefined) return null;
  const original = typeof value === "string" ? value : String(value);
  if (original.length < MIN_LEN) return null;

  const sig = countMojibakeSignals(original);
  const sq = countSmartQuoteArtifacts(original);
  const ar = countArabicLetters(original);

  if (sig === 0 && sq === 0) return null;

  const issueKinds: EncodingIssueKind[] = [];
  if (sig > 0) issueKinds.push("mojibake_signature");
  if (sq > 0) issueKinds.push("smart_quote_artifact");

  const len = original.length;
  const density = (sig + sq * 0.5) / Math.max(24, len * 0.12);
  let confidence = Math.min(0.95, 0.25 + density * 1.4);
  if (ar > 0 && sig > 0) confidence = Math.max(confidence, 0.45);

  const bestRepair = pickBestRepair(original);
  if (bestRepair && bestRepair.confidenceAfter > scoreLikelyGoodArabic(original) + 0.08) {
    confidence = Math.min(0.98, confidence + 0.12);
    if (bestRepair.strategy === "chained_latin1_utf8") issueKinds.push("double_encoding_suspected");
  } else if (sig > 0 && !bestRepair) {
    confidence = Math.min(confidence, 0.41);
    issueKinds.push("low_confidence_suspect");
  }

  if (confidence < 0.38 && sig < 2 && sq < 2) return null;

  return {
    original,
    issueKinds: [...new Set(issueKinds)],
    confidence: Math.round(confidence * 1e5) / 1e5,
    bestRepair,
  };
}

export function previewSlice(s: string, max = 280): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/** Heuristic for print/PDF pipelines: Arabic present and no obvious mojibake. */
export function glyphAndEncodingPrintHint(text: string): {
  hasArabic: boolean;
  mojibakeRisk: "low" | "medium" | "high";
  recommendation: string;
} {
  const hasArabic = countArabicLetters(text) > 0;
  const sig = countMojibakeSignals(text);
  const sq = countSmartQuoteArtifacts(text);
  let mojibakeRisk: "low" | "medium" | "high" = "low";
  if (sig + sq > 6) mojibakeRisk = "high";
  else if (sig + sq > 1) mojibakeRisk = "medium";
  let recommendation = "Text looks UTF-8 clean for typical browser print / PDF.";
  if (mojibakeRisk !== "low") {
    recommendation =
      "Corruption patterns detected — fix source data or re-export after running encoding repair; embed Cairo/Noto Naskh Arabic in headless PDF if applicable.";
  } else if (hasArabic) {
    recommendation = "Arabic codepoints present — ensure print CSS uses an Arabic-capable webfont (e.g. Cairo).";
  }
  return { hasArabic, mojibakeRisk, recommendation };
}
