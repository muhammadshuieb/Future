import { cn } from "../../lib/utils";
import { useI18n } from "../../context/LocaleContext";

type LogoSize = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<LogoSize, { mark: string; text: string; sub: string; gap: string }> = {
  sm: { mark: "h-8 w-8", text: "text-sm", sub: "text-[9px]", gap: "gap-2" },
  md: { mark: "h-11 w-11", text: "text-base", sub: "text-[10px]", gap: "gap-3" },
  lg: { mark: "h-16 w-16", text: "text-xl", sub: "text-xs", gap: "gap-3" },
  xl: { mark: "h-24 w-24", text: "text-3xl", sub: "text-sm", gap: "gap-4" },
};

/**
 * Pure SVG mark for Future Radius / شركة المستقبل.
 * - Hexagonal core (network node) with a forward chevron (future).
 * - Three expanding signal arcs (radius / broadcast).
 * - Neon gradient tuned to the app's primary → accent palette.
 */
export function LogoMark({
  className,
  size = "md",
  animated = true,
  id = "future-radius-logo",
}: {
  className?: string;
  size?: LogoSize;
  animated?: boolean;
  id?: string;
}) {
  const s = sizeMap[size];
  return (
    <svg
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(s.mark, "shrink-0 select-none drop-shadow-[0_6px_20px_rgba(99,102,241,0.35)]", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-core`} x1="10%" y1="0%" x2="90%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="hsl(var(--accent))" />
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.95" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.15" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer glow */}
      <circle cx="64" cy="64" r="58" fill={`url(#${id}-glow)`} />

      {/* Signal arcs (ripples) */}
      <g fill="none" strokeLinecap="round" stroke={`url(#${id}-arc)`}>
        <path
          d="M28 64a36 36 0 0 1 72 0"
          strokeWidth="6"
          opacity="0.9"
          className={animated ? "animate-[pulse_3.2s_ease-in-out_infinite]" : ""}
        />
        <path
          d="M18 64a46 46 0 0 1 92 0"
          strokeWidth="4"
          opacity="0.55"
          className={animated ? "animate-[pulse_3.8s_ease-in-out_infinite]" : ""}
        />
        <path
          d="M8 64a56 56 0 0 1 112 0"
          strokeWidth="2.5"
          opacity="0.3"
          className={animated ? "animate-[pulse_4.4s_ease-in-out_infinite]" : ""}
        />
      </g>

      {/* Core hexagon (network node) */}
      <g>
        <polygon
          points="64,22 100,42 100,86 64,106 28,86 28,42"
          fill={`url(#${id}-core)`}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1.5"
        />
        {/* Inner highlight */}
        <polygon
          points="64,30 94,46 94,82 64,98 34,82 34,46"
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1"
        />
        {/* Forward chevron = "future" */}
        <path
          d="M54 48 L78 64 L54 80"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Emitter dots at the core tips */}
      <g fill="#ffffff" opacity="0.95">
        <circle cx="64" cy="22" r="2.2" />
        <circle cx="100" cy="42" r="2.2" />
        <circle cx="100" cy="86" r="2.2" />
        <circle cx="64" cy="106" r="2.2" />
        <circle cx="28" cy="86" r="2.2" />
        <circle cx="28" cy="42" r="2.2" />
      </g>
    </svg>
  );
}

/**
 * Full brand lockup: logo mark + wordmark (Future Radius + شركة المستقبل).
 */
export function LogoLockup({
  size = "lg",
  className,
  stacked = false,
}: {
  size?: LogoSize;
  className?: string;
  stacked?: boolean;
}) {
  const { t } = useI18n();
  const s = sizeMap[size];
  return (
    <div
      className={cn(
        "inline-flex items-center",
        stacked ? "flex-col gap-2 text-center" : `flex-row ${s.gap}`,
        className
      )}
    >
      <LogoMark size={size} />
      <div className={cn("min-w-0", stacked ? "mt-1" : "")}>
        <div
          className={cn(
            "bg-gradient-to-r from-[hsl(var(--primary))] via-violet-500 to-[hsl(var(--accent))] bg-clip-text font-extrabold leading-none tracking-tight text-transparent",
            s.text
          )}
        >
          Future Radius
        </div>
        <div className={cn("mt-1 font-semibold text-[hsl(var(--muted-foreground))]", s.sub)}>{t("brand.tagline")}</div>
      </div>
    </div>
  );
}
