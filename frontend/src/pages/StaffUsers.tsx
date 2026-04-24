import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { SelectField, TextField } from "../components/ui/TextField";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";
import { canManageStaff } from "../lib/permissions";
import { cn } from "../lib/utils";

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "accountant" | "viewer";
  active: boolean;
  created_at?: string | null;
  wallet_balance?: number;
  opening_balance?: number;
  parent_staff_id?: string | null;
  permissions_json?: Record<string, boolean> | string | null;
};

const roles: StaffRow["role"][] = ["admin", "manager", "accountant", "viewer"];
const managerPermissionOptions = [
  "manage_subscribers",
  "renew_subscriptions",
  "manage_invoices",
  "manage_managers",
  "transfer_balance",
  "disconnect_users",
] as const;
type ManagerPermissionKey = (typeof managerPermissionOptions)[number];

function defaultManagerPermissions(): Record<ManagerPermissionKey, boolean> {
  return {
    manage_subscribers: true,
    renew_subscriptions: true,
    manage_invoices: true,
    manage_managers: true,
    transfer_balance: true,
    disconnect_users: true,
  };
}

function normalizePermissions(raw: StaffRow["permissions_json"]): Record<ManagerPermissionKey, boolean> {
  let src: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      src = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      src = {};
    }
  } else if (raw && typeof raw === "object") {
    src = raw;
  }
  const out = defaultManagerPermissions();
  for (const key of managerPermissionOptions) {
    if (key in src) out[key] = Boolean(src[key]);
  }
  return out;
}

export function StaffUsersPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageStaff(user?.role);
  const [items, setItems] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRow["role"]>("viewer");
  const [active, setActive] = useState(true);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [permissions, setPermissions] = useState<Record<ManagerPermissionKey, boolean>>(defaultManagerPermissions());
  const [parentStaffId, setParentStaffId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/staff/");
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const json = (await res.json()) as { items: StaffRow[] };
      setItems(json.items);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditId(null);
    setName("");
    setEmail("");
    setPassword("");
    setRole("viewer");
    setActive(true);
    setOpeningBalance("0");
    setPermissions(defaultManagerPermissions());
    setParentStaffId("");
    setModal("create");
  }

  function openEdit(item: StaffRow) {
    setEditId(item.id);
    setName(item.name);
    setEmail(item.email);
    setPassword("");
    setRole(item.role);
    setActive(Boolean(item.active));
    setOpeningBalance(String(item.opening_balance ?? 0));
    setPermissions(normalizePermissions(item.permissions_json ?? null));
    setParentStaffId(String(item.parent_staff_id ?? ""));
    setModal("edit");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name,
        email,
        role,
        active,
        opening_balance: Number(openingBalance || 0),
        parent_staff_id: role === "manager" && parentStaffId ? parentStaffId : null,
        permissions: role === "manager" ? permissions : undefined,
        ...(password ? { password } : {}),
      };
      const res =
        modal === "create"
          ? await apiFetch("/api/staff/", { method: "POST", body: JSON.stringify({ ...body, password }) })
          : await apiFetch(`/api/staff/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function topupManager(item: StaffRow) {
    const input = window.prompt(t("staff.topupAmountPrompt"), "0");
    if (!input) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/staff/${item.id}/topup`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return <p className="text-sm opacity-70">{t("staff.forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      <div className="sticky-list-panel flex flex-col gap-4 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("staff.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("staff.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          <Button type="button" onClick={openCreate}>
            <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("staff.add")}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs font-medium uppercase tracking-wide opacity-70">
                <th className="px-4 py-3 text-left">{t("staff.name")}</th>
                <th className="px-4 py-3 text-left">{t("login.email")}</th>
                <th className="px-4 py-3 text-left">{t("staff.role")}</th>
                <th className="px-4 py-3 text-left">{t("users.status")}</th>
                <th className="px-4 py-3 text-left">{t("staff.walletBalance")}</th>
                <th className="px-4 py-3 text-left">{t("users.createdAt")}</th>
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/60">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3">{item.email}</td>
                  <td className="px-4 py-3">{item.role}</td>
                  <td className="px-4 py-3">{item.active ? t("staff.active") : t("staff.inactive")}</td>
                  <td className="px-4 py-3">{Number(item.wallet_balance ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-xs opacity-80">
                    {String(item.created_at ?? "").slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.role === "manager" ? (
                      <button
                        type="button"
                        onClick={() => void topupManager(item)}
                        className="rounded-lg px-2 py-1 text-xs text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      >
                        {t("staff.topup")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "edit" ? t("common.edit") : t("staff.add")} wide>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("staff.name")} value={name} onChange={(e) => setName(e.target.value)} required />
            <TextField label={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={modal === "edit" ? t("staff.passwordOptional") : t("login.password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={modal === "create"}
            />
            <SelectField label={t("staff.role")} value={role} onChange={(e) => setRole(e.target.value as StaffRow["role"])}>
              {roles.map((roleValue) => (
                <option key={roleValue} value={roleValue}>
                  {roleValue}
                </option>
              ))}
            </SelectField>
          </div>
          {role === "manager" ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
              <TextField
                label={t("staff.openingBalance")}
                type="number"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <SelectField
                label={t("staff.parentManager")}
                value={parentStaffId}
                onChange={(e) => setParentStaffId(e.target.value)}
              >
                <option value="">{t("common.none")}</option>
                {items
                  .filter((row) => row.role === "manager" && row.id !== editId)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} ({row.email})
                    </option>
                  ))}
              </SelectField>
              <div className="grid gap-2 sm:grid-cols-2">
                {managerPermissionOptions.map((perm) => (
                  <label key={perm} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(permissions[perm])}
                      onChange={(e) => setPermissions((prev) => ({ ...prev, [perm]: e.target.checked }))}
                    />
                    {t(`staff.permissions.${perm}`)}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("staff.active")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
