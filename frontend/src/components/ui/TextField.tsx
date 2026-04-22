import { cn } from "../../lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 backdrop-blur px-3 py-2.5 text-sm outline-none transition placeholder:text-[hsl(var(--foreground))]/40 focus:border-[hsl(var(--primary))]/60 focus:ring-2 focus:ring-[hsl(var(--primary))]/30";

export function TextField({
  label,
  hint,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const cid = id ?? props.name ?? label.replace(/\s/g, "-");
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <input id={cid} className={fieldClass} {...props} />
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
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <select id={cid} className={fieldClass} {...props}>
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
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={cid} className="block text-xs font-medium text-[hsl(var(--foreground))]/80">
        {label}
      </label>
      <textarea id={cid} className={cn(fieldClass, "min-h-[88px]")} {...props} />
    </div>
  );
}
