import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

export function Card({
  className,
  children,
  delay = 0,
}: {
  className?: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className={cn(
        "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm",
        className
      )}
    >
      {children}
    </motion.div>
  );
}
