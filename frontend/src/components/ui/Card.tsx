import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

export function Card({
  className,
  children,
  delay = 0,
  variant = "glass",
}: {
  className?: string;
  children: ReactNode;
  delay?: number;
  variant?: "glass" | "solid" | "subtle";
}) {
  const surface =
    variant === "solid"
      ? "bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-sm"
      : variant === "subtle"
        ? "glass-subtle"
        : "glass";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={cn("rounded-2xl p-5", surface, className)}
    >
      {children}
    </motion.div>
  );
}
