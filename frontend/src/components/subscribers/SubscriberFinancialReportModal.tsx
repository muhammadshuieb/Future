import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Loader2, MessageCircle, Printer } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useI18n } from "../../context/LocaleContext";
import { apiFetch, formatStaffApiError, readApiError } from "../../lib/api";
import {
  buildSubscriberFinancialReportHtml,
  fetchSubscriberFinancialReportData,
} from "../../lib/subscriber-financial-report-print";
import { cn } from "../../lib/utils";

type Props = {
  open: boolean;
  subscriberId: string | null;
  username: string;
  onClose: () => void;
};

export function SubscriberFinancialReportModal({ open, subscriberId, username, onClose }: Props) {
  const { t, isRtl } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!open || !subscriberId) {
      setHtml(null);
      setError(null);
      setLoading(false);
      setWaMsg(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setHtml(null);
      setWaMsg(null);
      const reportLabels = {
        title: t("users.financialReportPrint.title"),
        subscriber: t("users.financialReportPrint.subscriber"),
        since: t("users.financialReportPrint.since"),
        expires: t("users.financialReportPrint.expires"),
        package: t("users.financialReportPrint.package"),
        invoices: t("users.financialReportPrint.invoices"),
        issueDate: t("users.financialReportPrint.issueDate"),
        payments: t("users.financialReportPrint.payments"),
        paymentDate: t("users.financialReportPrint.paymentDate"),
        totals: t("users.financialReportPrint.totals"),
        invoiced: t("users.financialReportPrint.invoiced"),
        paid: t("users.financialReportPrint.paid"),
        outstanding: t("users.financialReportPrint.outstanding"),
        noData: t("users.financialReportPrint.noData"),
        loadError: t("users.financialReportPrint.loadError"),
      };
      try {
        const rep = await fetchSubscriberFinancialReportData(subscriberId);
        if (cancelled) return;
        const dir = isRtl ? "rtl" : "ltr";
        setHtml(buildSubscriberFinancialReportHtml(rep, reportLabels, dir));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, subscriberId, isRtl, t]);

  const handlePrint = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
  }, []);

  const handleDownloadHtml = useCallback(() => {
    if (!html || !subscriberId) return;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${username || "subscriber"}-financial-report.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [html, subscriberId, username]);

  const handleWhatsApp = useCallback(async () => {
    if (!subscriberId) return;
    setWaBusy(true);
    setWaMsg(null);
    try {
      const r = await apiFetch(`/api/subscribers/${encodeURIComponent(subscriberId)}/whatsapp-financial-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setWaMsg({ type: "err", text: formatStaffApiError(r.status, raw, t) });
        return;
      }
      setWaMsg({ type: "ok", text: t("users.financialReportModal.whatsappSent") });
    } catch (e) {
      setWaMsg({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWaBusy(false);
    }
  }, [subscriberId, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("users.financialReport")} — ${username}`}
      wide
    >
      <div className="space-y-3" dir={isRtl ? "rtl" : "ltr"}>
        <p className="text-xs leading-relaxed opacity-70">{t("users.financialReportModal.printHint")}</p>
        {waMsg ? (
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              waMsg.type === "err"
                ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
            )}
          >
            {waMsg.text}
          </p>
        ) : null}
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-sm opacity-80">
            <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
            {t("common.loading")}
          </div>
        ) : error ? (
          <p className="whitespace-pre-wrap rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {t("users.financialReportPrint.loadError")}: {error}
          </p>
        ) : html ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="soft" onClick={handlePrint}>
                <Printer className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
                {t("users.financialReportModal.printOrPdf")}
              </Button>
              <Button type="button" variant="outline" onClick={handleDownloadHtml}>
                <FileDown className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
                {t("users.financialReportModal.downloadHtml")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleWhatsApp()} disabled={waBusy}>
                <MessageCircle className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
                {waBusy ? t("common.loading") : t("users.financialReportModal.sendWhatsApp")}
              </Button>
            </div>
            <iframe
              ref={iframeRef}
              title={t("users.financialReportPrint.title")}
              srcDoc={html}
              sandbox="allow-modals allow-same-origin"
              className="h-[min(70vh,720px)] w-full rounded-xl border border-[hsl(var(--border))] bg-white text-black dark:bg-[#f8fafc]"
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
