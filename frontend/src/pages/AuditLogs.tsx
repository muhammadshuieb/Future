import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ActionDialog } from "../components/ui/ActionDialog";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";

type AuditRow = {
  id: string;
  staff_id: string | null;
  staff_name?: string | null;
  staff_email?: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: unknown;
  created_at: string;
};

export function AuditLogsPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const canClear = user?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const q = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (actionFilter.trim()) q.set("action", actionFilter.trim());
      if (entityFilter.trim()) q.set("entity_type", entityFilter.trim());
      const res = await apiFetch(`/api/audit?${q.toString()}`);
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const data = (await res.json()) as {
        items: AuditRow[];
        meta?: { total?: number };
      };
      setItems(data.items ?? []);
      setTotal(Number(data.meta?.total ?? 0));
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter, page, perPage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function clearAll() {
    if (!canClear) return;
    setConfirmClearOpen(true);
  }

  async function confirmClearAll() {
    setConfirmClearOpen(false);
    if (!canClear) return;
    const res = await apiFetch("/api/audit", { method: "DELETE" });
    if (!res.ok) {
      const raw = await readApiError(res);
      setError(formatStaffApiError(res.status, raw, t));
      return;
    }
    setMessage(t("audit.cleared"));
    setPage(1);
    await load();
  }

  const rows = useMemo(() => items, [items]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("audit.title")}</h1>
        <p className="mt-1 text-sm opacity-70">{t("audit.subtitle")}</p>
      </div>

      <Card className="sticky-list-panel flex flex-wrap items-end gap-2 p-4">
        <TextField
          label={t("audit.action")}
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          placeholder="renew, topup, update..."
        />
        <TextField
          label={t("audit.entity")}
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setPage(1);
          }}
          placeholder="subscriber, manager_wallet..."
        />
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          {t("common.refresh")}
        </Button>
        {canClear ? (
          <Button type="button" variant="outline" onClick={() => void clearAll()} className="text-red-600">
            <Trash2 className={isRtl ? "ms-2 h-4 w-4" : "me-2 h-4 w-4"} />
            {t("audit.clearAll")}
          </Button>
        ) : null}
      </Card>

      {message ? <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">{message}</p> : null}
      {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase tracking-wide opacity-70">
                <th className="px-4 py-3 text-start">{t("audit.time")}</th>
                <th className="px-4 py-3 text-start">{t("audit.actor")}</th>
                <th className="px-4 py-3 text-start">{t("audit.action")}</th>
                <th className="px-4 py-3 text-start">{t("audit.entity")}</th>
                <th className="px-4 py-3 text-start">{t("audit.details")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[hsl(var(--border))]/50">
                  <td className="px-4 py-3 font-mono text-xs">{String(row.created_at ?? "").replace("T", " ").slice(0, 19)}</td>
                  <td className="px-4 py-3">{row.staff_name || row.staff_email || "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-[hsl(var(--muted))] px-2 py-0.5 text-xs">{row.action}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.entity_type}
                    {row.entity_id ? <span className="ms-2 opacity-60">({row.entity_id})</span> : null}
                  </td>
                  <td className="max-w-[360px] px-4 py-3 text-xs opacity-80">
                    <code className="line-clamp-3 whitespace-pre-wrap break-words">
                      {row.payload == null
                        ? "—"
                        : typeof row.payload === "string"
                          ? row.payload
                          : JSON.stringify(row.payload)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length === 0 ? <p className="p-6 text-center text-sm opacity-60">{t("audit.empty")}</p> : null}
      </Card>

      <Card className="flex items-center justify-between p-4 text-sm opacity-85">
        <span>
          {t("users.pageLabel")}: {page}/{totalPages}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            {t("users.prevPage")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            {t("users.nextPage")}
          </Button>
        </div>
      </Card>
      <ActionDialog
        open={confirmClearOpen}
        title={t("common.delete")}
        message={t("audit.clearConfirm")}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          void confirmClearAll();
        }}
      />
    </div>
  );
}
