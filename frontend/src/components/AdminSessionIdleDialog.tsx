import { Clock } from "lucide-react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useI18n } from "../context/LocaleContext";

export function AdminSessionIdleDialog({
  open,
  secondsLeft,
  onContinue,
}: {
  open: boolean;
  secondsLeft: number;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const secs = Math.max(0, secondsLeft);

  return (
    <Modal
      open={open}
      title={t("sessionIdle.title")}
      onClose={onContinue}
      closeOnBackdrop={false}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="leading-relaxed text-[hsl(var(--foreground))]/90">{t("sessionIdle.message")}</p>
        </div>
        <div className="flex flex-col items-center gap-1 py-2">
          <span className="text-5xl font-bold tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
            {secs}
          </span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{t("sessionIdle.secondsUnit")}</span>
        </div>
        <Button type="button" className="w-full" onClick={onContinue}>
          {t("sessionIdle.continueBrowsing")}
        </Button>
      </div>
    </Modal>
  );
}
