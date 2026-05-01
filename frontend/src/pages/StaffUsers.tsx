import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { ActionDialog } from "../components/ui/ActionDialog";
import { ColumnVisibilityMenu, useColumnVisibility } from "../components/ui/ColumnVisibilityMenu";
import { SelectField, TextField } from "../components/ui/TextField";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/LocaleContext";
import { hasStaffPermission } from "../lib/permissions";
import { cn } from "../lib/utils";

type StaffRow = {
  id: string;
  name: string;
  managername?: string;
  firstname?: string;
  lastname?: string;
  email: string;
  role: "admin" | "manager" | "accountant" | "viewer";
  active: boolean;
  created_at?: string | null;
  wallet_balance?: number;
  opening_balance?: number;
  allowed_negative_balance?: number;
  parent_staff_id?: string | null;
  permissions_json?: Record<string, boolean> | string | null;
  legacy_source?: string;
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
  function dedupeRepeatedWords(value: string): string {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
      return parts[0];
    }
    return parts.join(" ");
  }

  function displayName(item: StaffRow): string {
    if (item.managername && String(item.managername).trim()) {
      return String(item.managername).trim();
    }
    const first = String(item.firstname ?? "").trim();
    const last = String(item.lastname ?? "").trim();
    if (first || last) return dedupeRepeatedWords(`${first} ${last}`.trim());
    return dedupeRepeatedWords(String(item.name ?? "").trim());
  }

  function displayRole(item: StaffRow): StaffRow["role"] {
    const managerName = String(item.managername ?? "").trim().toLowerCase();
    if (managerName === "admin" || managerName === "root") return "admin";
    return item.role;
  }

  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManageManagers = hasStaffPermission(user?.role, user?.permissions, "manage_managers");
  const canTransferBalance = hasStaffPermission(user?.role, user?.permissions, "transfer_balance");
  const canManage = canManageManagers || canTransferBalance;
  const [items, setItems] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changePassword, setChangePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<StaffRow["role"]>("viewer");
  const [active, setActive] = useState(true);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [allowedNegativeBalance, setAllowedNegativeBalance] = useState("0");
  const [permissions, setPermissions] = useState<Record<ManagerPermissionKey, boolean>>(defaultManagerPermissions());
  const [parentStaffId, setParentStaffId] = useState("");
  const isLegacyEditing = modal === "edit" && String(editId ?? "").startsWith("rm:");
  const [topupTarget, setTopupTarget] = useState<StaffRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const staffColumns = useMemo(
    () => [
      { key: "name", label: t("staff.name") },
      { key: "email", label: t("login.email") },
      { key: "role", label: t("staff.role") },
      { key: "status", label: t("users.status") },
      { key: "wallet", label: t("staff.walletBalance") },
      { key: "negative", label: t("staff.allowedNegativeBalance"), defaultVisible: false },
      { key: "created_at", label: t("users.createdAt"), defaultVisible: false },
    ],
    [t]
  );
  const staffColumnVisibility = useColumnVisibility("staff-users", staffColumns);

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
    } catch {
      setError(t("common.error"));
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
    setConfirmPassword("");
    setChangePassword(true);
    setShowPassword(false);
    setRole("viewer");
    setActive(true);
    setOpeningBalance("0");
    setAllowedNegativeBalance("0");
    setPermissions(defaultManagerPermissions());
    setParentStaffId("");
    setModalError(null);
    setModal("create");
  }

  function openEdit(item: StaffRow) {
    setEditId(item.id);
    setName(displayName(item));
    setEmail(item.email);
    setPassword("");
    setConfirmPassword("");
    setChangePassword(false);
    setShowPassword(false);
    setRole(item.role);
    setActive(Boolean(item.active));
    setOpeningBalance(String(item.opening_balance ?? 0));
    setAllowedNegativeBalance(String(item.allowed_negative_balance ?? 0));
    setPermissions(normalizePermissions(item.permissions_json ?? null));
    setParentStaffId(String(item.parent_staff_id ?? ""));
    setModalError(null);
    setModal("edit");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageManagers) {
      setModalError(t("staff.forbidden"));
      return;
    }
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setModalError(t("staff.name"));
      return;
    }
    const shouldChangePassword = modal === "create" || changePassword;
    if (modal === "create" && !password) {
      setModalError(t("common.required"));
      return;
    }
    if (shouldChangePassword && password && password.length < 6) {
      setModalError(t("api.error_invalid_body"));
      return;
    }
    if (shouldChangePassword && password !== confirmPassword) {
      setModalError(t("staff.passwordMismatch"));
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      const parsedOpeningBalance = Number(openingBalance);
      const parsedAllowedNegativeBalance = Number(allowedNegativeBalance);
      const hasOpeningBalance = Number.isFinite(parsedOpeningBalance);
      const hasAllowedNegativeBalance = Number.isFinite(parsedAllowedNegativeBalance);
      const body: Record<string, unknown> = {
        name: trimmedName,
        email: trimmedEmail || undefined,
        role,
        active,
        parent_staff_id: role === "manager" && parentStaffId ? parentStaffId : null,
        permissions: role === "manager" ? permissions : undefined,
        ...((shouldChangePassword && password) ? { password } : {}),
      };
      if (modal === "create" && hasOpeningBalance) {
        body.opening_balance = parsedOpeningBalance;
      }
      if (hasAllowedNegativeBalance) {
        body.allowed_negative_balance = parsedAllowedNegativeBalance;
      }
      const res =
        modal === "create"
          ? await apiFetch("/api/staff/", { method: "POST", body: JSON.stringify({ ...body, password }) })
          : await apiFetch(`/api/staff/${editId}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        const raw = await readApiError(res);
        setModalError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setModal(null);
      await load();
    } catch {
      setModalError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function topupManager(item: StaffRow) {
    if (!canTransferBalance) return;
    setTopupTarget(item);
  }

  async function confirmTopup(input?: string) {
    const target = topupTarget;
    setTopupTarget(null);
    if (!target) return;
    const amount = Number(input ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/staff/${target.id}/topup`, {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      await load();
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteStaff(item: StaffRow) {
    if (!canManageManagers) return;
    setDeleteTarget(item);
  }

  async function confirmDeleteStaff() {
    const item = deleteTarget;
    setDeleteTarget(null);
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/staff/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      await load();
    } catch {
      setError(t("common.error"));
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
          <Button type="button" onClick={openCreate} disabled={!canManageManagers}>
            <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("staff.add")}
          </Button>
          <ColumnVisibilityMenu
            title="الأعمدة"
            columns={staffColumns}
            visibleKeys={staffColumnVisibility.visibleKeys}
            onToggle={staffColumnVisibility.toggle}
            onShowAll={staffColumnVisibility.showAll}
            onResetDefault={staffColumnVisibility.resetDefault}
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs font-medium uppercase tracking-wide opacity-70">
                {staffColumnVisibility.isVisible("name") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("staff.name")}</th> : null}
                {staffColumnVisibility.isVisible("email") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("login.email")}</th> : null}
                {staffColumnVisibility.isVisible("role") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("staff.role")}</th> : null}
                {staffColumnVisibility.isVisible("status") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("users.status")}</th> : null}
                {staffColumnVisibility.isVisible("wallet") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("staff.walletBalance")}</th> : null}
                {staffColumnVisibility.isVisible("negative") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("staff.allowedNegativeBalance")}</th> : null}
                {staffColumnVisibility.isVisible("created_at") ? <th className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{t("users.createdAt")}</th> : null}
                <th className="px-4 py-3 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/60">
                  {staffColumnVisibility.isVisible("name") ? <td className={cn("px-4 py-3 font-medium", isRtl ? "text-right" : "text-left")}>{displayName(item)}</td> : null}
                  {staffColumnVisibility.isVisible("email") ? <td className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{item.email || "—"}</td> : null}
                  {staffColumnVisibility.isVisible("role") ? <td className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{displayRole(item)}</td> : null}
                  {staffColumnVisibility.isVisible("status") ? <td className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        item.active
                          ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border border-red-500/30 bg-red-500/15 text-red-300"
                      )}
                    >
                      {item.active ? t("staff.active") : t("staff.inactive")}
                    </span>
                  </td> : null}
                  {staffColumnVisibility.isVisible("wallet") ? <td className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>{Number(item.wallet_balance ?? 0).toFixed(2)}</td> : null}
                  {staffColumnVisibility.isVisible("negative") ? <td className={cn("px-4 py-3", isRtl ? "text-right" : "text-left")}>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        Number(item.allowed_negative_balance ?? 0) > 0
                          ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : "border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 text-[hsl(var(--muted-foreground))]"
                      )}
                    >
                      {Number(item.allowed_negative_balance ?? 0).toFixed(2)}
                    </span>
                  </td> : null}
                  {staffColumnVisibility.isVisible("created_at") ? <td className={cn("px-4 py-3 font-mono text-xs opacity-80", isRtl ? "text-right" : "text-left")}>
                    {String(item.created_at ?? "").slice(0, 16).replace("T", " ")}
                  </td> : null}
                  <td className="px-4 py-3 text-right">
                    {canTransferBalance && (item.role === "manager" || String(item.id).startsWith("rm:")) ? (
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
                      disabled={!canManageManagers}
                      className="rounded-lg p-2 text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))]"
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteStaff(item)}
                      disabled={
                        !canManageManagers ||
                        String(item.id) === String(user?.id) ||
                        (String(item.id).startsWith("rm:") &&
                          String(item.managername ?? item.name).trim().toLowerCase() ===
                            String(user?.name ?? "").trim().toLowerCase())
                      }
                      className="rounded-lg p-2 text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={modal !== null}
        onClose={() => {
          setModalError(null);
          setModal(null);
        }}
        title={modal === "edit" ? t("common.edit") : t("staff.add")}
        wide
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {modalError ? (
            <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {modalError}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t("staff.name")} value={name} onChange={(e) => setName(e.target.value)} required />
            <TextField label={t("staff.emailOptional")} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {modal === "edit" ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={changePassword}
                  onChange={(e) => {
                    setChangePassword(e.target.checked);
                    if (!e.target.checked) {
                      setPassword("");
                      setConfirmPassword("");
                    }
                  }}
                />
                {t("staff.changePassword")}
              </label>
            ) : null}
            <div className="space-y-1">
              <TextField
                label={modal === "edit" ? t("staff.passwordOptional") : t("login.password")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPassword ? t("staff.hidePassword") : t("staff.showPassword")}
              </button>
            </div>
            <TextField
              label={t("staff.confirmPassword")}
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t("staff.role")} value={role} onChange={(e) => setRole(e.target.value as StaffRow["role"])}>
              {roles.map((roleValue) => (
                <option key={roleValue} value={roleValue}>
                  {roleValue}
                </option>
              ))}
            </SelectField>
          </div>
          {role === "manager" || isLegacyEditing ? (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-3">
              <TextField
                label={t("staff.openingBalance")}
                type="number"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <TextField
                label={t("staff.allowedNegativeBalance")}
                type="number"
                value={allowedNegativeBalance}
                onChange={(e) => setAllowedNegativeBalance(e.target.value)}
              />
              {role === "manager" ? (
                <>
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
                </>
              ) : null}
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
      <ActionDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={t("staff.deleteConfirm")}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDeleteStaff();
        }}
      />
      <ActionDialog
        open={Boolean(topupTarget)}
        title={t("staff.topup")}
        message={t("staff.topupAmountPrompt")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onClose={() => setTopupTarget(null)}
        onConfirm={(value) => {
          void confirmTopup(value);
        }}
        input={{
          label: t("staff.topup"),
          placeholder: "0",
          defaultValue: "0",
          type: "number",
        }}
      />
    </div>
  );
}
