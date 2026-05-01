import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";

type ActionDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onClose: () => void;
  onConfirm: (value?: string) => void;
  variant?: "warning" | "danger";
  input?: {
    label: string;
    placeholder?: string;
    defaultValue?: string;
    type?: "text" | "number";
  };
};

export function ActionDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onClose,
  onConfirm,
  variant = "warning",
  input,
}: ActionDialogProps) {
  const [value, setValue] = useState(input?.defaultValue ?? "");

  useEffect(() => {
    if (!open) return;
    setValue(input?.defaultValue ?? "");
  }, [open, input?.defaultValue]);

  const danger = variant === "danger";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div
          className={
            danger
              ? "rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              : "rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          }
        >
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            <span>{title}</span>
          </div>
          <p className="whitespace-pre-wrap">{message}</p>
        </div>
        {input ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium opacity-80">{input.label}</span>
            <input
              type={input.type ?? "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={input.placeholder}
              className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 px-3 py-2.5 text-sm outline-none transition placeholder:text-[hsl(var(--foreground))]/40 focus:border-[hsl(var(--primary))]/60 focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
            />
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={() => onConfirm(input ? value : undefined)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
