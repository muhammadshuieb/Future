import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "outline" | "soft" | "danger" | "success";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const v =
    variant === "primary"
      ? "btn-gradient hover:brightness-110 active:brightness-95"
      : variant === "outline"
        ? "border border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 backdrop-blur hover:bg-[hsl(var(--muted))]/60"
        : variant === "soft"
          ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/15"
          : variant === "danger"
            ? "bg-red-500/90 text-white hover:bg-red-500 shadow-sm shadow-red-500/30"
            : variant === "success"
              ? "bg-emerald-500/90 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-500/30"
              : "hover:bg-[hsl(var(--muted))]/70";
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]/50 disabled:opacity-50 disabled:pointer-events-none",
        v,
        className
      )}
      {...props}
    />
  );
}
