import { useEffect, useState } from "react";
import { useI18n } from "../../context/LocaleContext";
import { apiFetch } from "../../lib/api";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../context/AuthContext";

function canSeeEnterprise(user: { role?: string; permissions?: Record<string, boolean> } | null, key: string) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return Boolean(user.permissions?.[key]);
}

export function ResellersListPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [data, setData] = useState<unknown>(null);
  const ok = canSeeEnterprise(user, "view_resellers");
  useEffect(() => {
    if (!ok) return;
    void (async () => {
      const r = await apiFetch("/api/resellers");
      if (r.ok) setData(await r.json());
    })();
  }, [ok]);
  if (!ok) return <div dir={isRtl ? "rtl" : "ltr"}>{t("api.error_403")}</div>;
  return (
    <div className="p-4" dir={isRtl ? "rtl" : "ltr"}>
      <Card className="p-4">
        <h1 className="mb-2 text-lg font-bold">{t("nav.resellers")}</h1>
        <pre className="text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </div>
  );
}
