import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const v =
    variant === "primary"
      ? "bg-[hsl(var(--primary))] text-white hover:opacity-90"
      : variant === "outline"
        ? "border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--muted))]"
        : "hover:bg-[hsl(var(--muted))]";
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition",
        v,
        className
      )}
      {...props}
    />
  );
}
