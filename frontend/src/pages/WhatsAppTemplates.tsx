import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, Sparkles } from "lucide-react";
import { apiFetch, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { TextAreaField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type Template = {
  template_key: "new_account" | "expiry_soon" | "payment_due" | "usage_threshold";
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
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [autoFixing, setAutoFixing] = useState(false);

  function looksCorrupted(body: string): boolean {
    const qCount = (body.match(/\?/g) || []).length;
    return qCount >= 8;
  }

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/api/whatsapp/templates");
      if (!r.ok) throw new Error(await readApiError(r));
      const data = (await r.json()) as { items: Template[] };
      const next = {
        new_account: data.items.find((x) => x.template_key === "new_account")?.body ?? "",
        expiry_soon: data.items.find((x) => x.template_key === "expiry_soon")?.body ?? "",
        payment_due: data.items.find((x) => x.template_key === "payment_due")?.body ?? "",
        usage_threshold: data.items.find((x) => x.template_key === "usage_threshold")?.body ?? "",
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

  async function save() {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const [a, b, c, d] = await Promise.all([
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
      ]);
      if (!a.ok) throw new Error(await readApiError(a));
      if (!b.ok) throw new Error(await readApiError(b));
      if (!c.ok) throw new Error(await readApiError(c));
      if (!d.ok) throw new Error(await readApiError(d));
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
        <div className="text-xs opacity-70">
          {t("whatsapp.templateVars")}:{" "}
          <code>
            {"{{full_name}}, {{username}}, {{password}}, {{package_name}}, {{speed}}, {{expiration_date}}, {{days_left}}, {{due_amount}}, {{currency}}, {{unpaid_count}}, {{oldest_due_date}}, {{usage_percent}}, {{used_gb}}, {{quota_gb}}, {{remaining_percent}}"}
          </code>
        </div>
      </Card>
    </div>
  );
}
