import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, Sparkles } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { whatsAppEmojiPreviewSrc } from "../lib/whatsappEmoji";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextAreaField, TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type Template = {
  template_key: "new_account" | "expiry_soon" | "payment_due" | "usage_threshold" | "invoice_paid";
  body: string;
  updated_at: string | null;
};

export function WhatsAppTemplatesPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const [templates, setTemplates] = useState<Record<Template["template_key"], string>>({
    new_account: "",
    expiry_soon: "",
    payment_due: "",
    usage_threshold: "",
    invoice_paid: "",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [autoFixing, setAutoFixing] = useState(false);
  const [waSettings, setWaSettings] = useState({
    enabled: false,
    waha_url: "",
    session_name: "",
    api_key: "",
    reminder_days: 5,
    message_interval_seconds: 30,
    auto_send_new: true,
    usage_alert_thresholds: [10, 20, 30, 50] as number[],
    company_name: "",
    emoji_image_url: "",
    emoji_image_preview_url: "",
    attach_emoji_image: false,
  });
  const [uploadingEmoji, setUploadingEmoji] = useState(false);

  function looksCorrupted(body: string): boolean {
    const qCount = (body.match(/\?/g) || []).length;
    return qCount >= 8;
  }

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [r, rSettings] = await Promise.all([
        apiFetch("/api/whatsapp/templates"),
        apiFetch("/api/whatsapp/settings"),
      ]);
      if (!r.ok) throw new Error(await readApiError(r));
      if (rSettings.ok) {
        const cfg = (await rSettings.json()) as {
          settings: {
            company_name?: string;
            emoji_image_url?: string;
            emoji_image_preview_url?: string;
            attach_emoji_image?: boolean;
            reminder_days?: number;
            message_interval_seconds?: number;
            auto_send_new?: boolean;
            usage_alert_thresholds?: number[];
            enabled?: boolean;
          };
        };
        setWaSettings({
          enabled: Boolean(cfg.settings.enabled),
          waha_url: String(cfg.settings.waha_url ?? ""),
          session_name: String(cfg.settings.session_name ?? ""),
          api_key: String(cfg.settings.api_key ?? ""),
          reminder_days: Number(cfg.settings.reminder_days ?? 5),
          message_interval_seconds: Number(cfg.settings.message_interval_seconds ?? 30),
          auto_send_new: Boolean(cfg.settings.auto_send_new ?? true),
          usage_alert_thresholds: cfg.settings.usage_alert_thresholds ?? [10, 20, 30, 50],
          company_name: cfg.settings.company_name ?? "",
          emoji_image_url: cfg.settings.emoji_image_url ?? "",
          emoji_image_preview_url: cfg.settings.emoji_image_preview_url ?? "",
          attach_emoji_image: Boolean(cfg.settings.attach_emoji_image),
        });
      }
      const data = (await r.json()) as { items: Template[] };
      const next = {
        new_account: data.items.find((x) => x.template_key === "new_account")?.body ?? "",
        expiry_soon: data.items.find((x) => x.template_key === "expiry_soon")?.body ?? "",
        payment_due: data.items.find((x) => x.template_key === "payment_due")?.body ?? "",
        usage_threshold: data.items.find((x) => x.template_key === "usage_threshold")?.body ?? "",
        invoice_paid: data.items.find((x) => x.template_key === "invoice_paid")?.body ?? "",
      };
      setTemplates(next);
      if (
        !autoFixing &&
        (looksCorrupted(next.new_account) ||
          looksCorrupted(next.expiry_soon) ||
          looksCorrupted(next.payment_due) ||
          looksCorrupted(next.usage_threshold))
      ) {
        setAutoFixing(true);
        const fixRes = await apiFetch("/api/whatsapp/templates/apply-professional-ar", {
          method: "POST",
          body: "{}",
        });
        if (fixRes.ok) {
          const refreshed = await apiFetch("/api/whatsapp/templates");
          if (refreshed.ok) {
            const fixed = (await refreshed.json()) as { items: Template[] };
            setTemplates({
              new_account: fixed.items.find((x) => x.template_key === "new_account")?.body ?? "",
              expiry_soon: fixed.items.find((x) => x.template_key === "expiry_soon")?.body ?? "",
              payment_due: fixed.items.find((x) => x.template_key === "payment_due")?.body ?? "",
              usage_threshold: fixed.items.find((x) => x.template_key === "usage_threshold")?.body ?? "",
              invoice_paid: fixed.items.find((x) => x.template_key === "invoice_paid")?.body ?? "",
            });
            setInfo(t("whatsapp.professionalApplied"));
          }
        }
        setAutoFixing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadEmojiImage(file: File) {
    setUploadingEmoji(true);
    setError(null);
    setInfo(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const r = await apiFetch("/api/whatsapp/emoji-image", { method: "POST", body: form });
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as {
        settings: { emoji_image_url?: string; emoji_image_preview_url?: string; attach_emoji_image?: boolean };
      };
      setWaSettings((s) => ({
        ...s,
        emoji_image_url: data.settings.emoji_image_url ?? "",
        emoji_image_preview_url: data.settings.emoji_image_preview_url ?? "",
        attach_emoji_image: Boolean(data.settings.attach_emoji_image),
      }));
      setInfo(t("whatsapp.emojiUploaded"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingEmoji(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const [a, b, c, d, e] = await Promise.all([
        apiFetch("/api/whatsapp/templates/new_account", {
          method: "PUT",
          body: JSON.stringify({ body: templates.new_account }),
        }),
        apiFetch("/api/whatsapp/templates/expiry_soon", {
          method: "PUT",
          body: JSON.stringify({ body: templates.expiry_soon }),
        }),
        apiFetch("/api/whatsapp/templates/payment_due", {
          method: "PUT",
          body: JSON.stringify({ body: templates.payment_due }),
        }),
        apiFetch("/api/whatsapp/templates/usage_threshold", {
          method: "PUT",
          body: JSON.stringify({ body: templates.usage_threshold }),
        }),
        apiFetch("/api/whatsapp/templates/invoice_paid", {
          method: "PUT",
          body: JSON.stringify({ body: templates.invoice_paid }),
        }),
      ]);
      if (!a.ok) throw new Error(await readApiError(a));
      if (!b.ok) throw new Error(await readApiError(b));
      if (!c.ok) throw new Error(await readApiError(c));
      if (!d.ok) throw new Error(await readApiError(d));
      if (!e.ok) throw new Error(await readApiError(e));
      const settingsRes = await apiFetch("/api/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: waSettings.enabled,
          waha_url: waSettings.waha_url || "",
          session_name: waSettings.session_name || "default",
          api_key: waSettings.api_key || "",
          reminder_days: waSettings.reminder_days,
          message_interval_seconds: waSettings.message_interval_seconds,
          auto_send_new: waSettings.auto_send_new,
          usage_alert_thresholds: waSettings.usage_alert_thresholds,
          company_name: waSettings.company_name,
          emoji_image_url: waSettings.emoji_image_url,
          attach_emoji_image: waSettings.attach_emoji_image,
        }),
      });
      if (!settingsRes.ok) throw new Error(await readApiError(settingsRes));
      setInfo(t("whatsapp.saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function applyProfessionalArabic() {
    setError(null);
    setInfo(null);
    const r = await apiFetch("/api/whatsapp/templates/apply-professional-ar", {
      method: "POST",
      body: "{}",
    });
    if (!r.ok) {
      setError(await readApiError(r));
      return;
    }
    setInfo(t("whatsapp.professionalApplied"));
    await load();
  }

  if (!canManage) return <p className="text-sm opacity-70">{t("api.error_403")}</p>;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("whatsapp.templatesPage")}</h1>
          <p className="text-sm opacity-70">{t("whatsapp.templatesPageHint")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""} ${isRtl ? "ms-2" : "me-2"}`} />
            {t("common.refresh")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void applyProfessionalArabic()}>
            <Sparkles className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {t("whatsapp.applyProfessional")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            <Save className={`h-4 w-4 ${isRtl ? "ms-2" : "me-2"}`} />
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div> : null}
      {info ? <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{info}</div> : null}

      <Card className="space-y-4">
        <div className="text-sm font-semibold">{t("whatsapp.templateOptions")}</div>
        <TextField
          label={t("whatsapp.companyName")}
          value={waSettings.company_name}
          onChange={(e) => setWaSettings((s) => ({ ...s, company_name: e.target.value }))}
          placeholder={t("whatsapp.companyNamePlaceholder")}
        />
        <div className="space-y-2">
          <label className="block text-sm font-medium">{t("whatsapp.emojiImageUpload")}</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={uploadingEmoji}
            className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-[hsl(var(--primary))] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[hsl(var(--primary-foreground))]"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadEmojiImage(file);
              e.target.value = "";
            }}
          />
          {uploadingEmoji ? <p className="text-xs opacity-60">{t("common.loading")}</p> : null}
          {whatsAppEmojiPreviewSrc(waSettings.emoji_image_preview_url, waSettings.emoji_image_url) ? (
            <img
              key={waSettings.emoji_image_url}
              src={whatsAppEmojiPreviewSrc(waSettings.emoji_image_preview_url, waSettings.emoji_image_url)}
              alt=""
              className="h-20 w-20 rounded-lg border border-[hsl(var(--border))] object-contain bg-white/5 p-1"
            />
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={waSettings.attach_emoji_image}
            onChange={(e) => setWaSettings((s) => ({ ...s, attach_emoji_image: e.target.checked }))}
          />
          {t("whatsapp.attachEmojiImage")}
        </label>
        <p className="text-xs opacity-60">{t("whatsapp.emojiImageHint")}</p>
      </Card>

      <Card className="space-y-4">
        <TextAreaField
          label={t("whatsapp.templateNew")}
          value={templates.new_account}
          onChange={(e) => setTemplates((x) => ({ ...x, new_account: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templateExpiry")}
          value={templates.expiry_soon}
          onChange={(e) => setTemplates((x) => ({ ...x, expiry_soon: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templatePaymentDue")}
          value={templates.payment_due}
          onChange={(e) => setTemplates((x) => ({ ...x, payment_due: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templateUsageThreshold")}
          value={templates.usage_threshold}
          onChange={(e) => setTemplates((x) => ({ ...x, usage_threshold: e.target.value }))}
        />
        <TextAreaField
          label={t("whatsapp.templateInvoicePaid")}
          value={templates.invoice_paid}
          onChange={(e) => setTemplates((x) => ({ ...x, invoice_paid: e.target.value }))}
        />
        <div className="text-xs opacity-70">
          {t("whatsapp.templateVars")}:{" "}
          <code>
            {"{{company_name}}, {{full_name}}, {{username}}, {{password}}, {{package_name}}, {{expiration_date}}, {{expiration_time}}, {{days_left}}, {{due_amount}}, {{currency}}, {{unpaid_count}}, {{oldest_due_date}}, {{billing_detail}}, {{usage_percent}}, {{used_gb}}, {{quota_gb}}, {{remaining_percent}}, {{invoice_no}}, {{amount}}, {{paid_at}}"}
          </code>
        </div>
        <p className="text-xs opacity-60">{t("whatsapp.templateVarsBillingHint")}</p>
      </Card>
    </div>
  );
}
