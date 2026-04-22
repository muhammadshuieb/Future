import { cn } from "../../lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function TextField({
  label,
  hint,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const cid = id ?? props.name ?? label.replace(/\s/g, "-");
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <input
        id={cid}
        className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm outline-none ring-[hsl(var(--primary))]/30 transition focus:ring-2"
        {...props}
      />
      {hint ? <p className="text-[11px] opacity-60">{hint}</p> : null}
    </div>
  );
}

export function SelectField({
  label,
  children,
  className,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const cid = id ?? props.name ?? label;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <select
        id={cid}
        className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm outline-none ring-[hsl(var(--primary))]/30 transition focus:ring-2"
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export function TextAreaField({
  label,
  className,
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const cid = id ?? props.name ?? label;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <textarea
        id={cid}
        className="min-h-[88px] w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm outline-none ring-[hsl(var(--primary))]/30 transition focus:ring-2"
        {...props}
      />
    </div>
  );
}
