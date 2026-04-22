import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

const permissionKeys = [
  "manage_subscribers",
  "renew_subscriptions",
  "manage_invoices",
  "manage_managers",
  "transfer_balance",
  "disconnect_users",
] as const;
type PermissionKey = (typeof permissionKeys)[number];
const permissionSections: Array<{ key: string; perms: PermissionKey[] }> = [
  { key: "subscribers", perms: ["manage_subscribers", "renew_subscriptions"] },
  { key: "billing", perms: ["manage_invoices", "transfer_balance"] },
  { key: "administration", perms: ["manage_managers"] },
  { key: "connectivity", perms: ["disconnect_users"] },
];

type RoleItem = {
  role: "manager" | "accountant" | "viewer";
  permissions: Record<PermissionKey, boolean>;
  updated_at?: string | null;
};

const roles: RoleItem["role"][] = ["manager", "accountant", "viewer"];

function defaultPermissions(): Record<PermissionKey, boolean> {
  return {
    manage_subscribers: true,
    renew_subscriptions: true,
    manage_invoices: true,
    manage_managers: true,
    transfer_balance: true,
    disconnect_users: true,
  };
}

export function RolesPermissionsPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const [items, setItems] = useState<Record<RoleItem["role"], RoleItem>>({
    manager: { role: "manager", permissions: defaultPermissions() },
    accountant: { role: "accountant", permissions: defaultPermissions() },
    viewer: { role: "viewer", permissions: defaultPermissions() },
  });
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/staff/roles-permissions");
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      const json = (await res.json()) as { items: RoleItem[] };
      const next: Record<RoleItem["role"], RoleItem> = {
        manager: { role: "manager", permissions: defaultPermissions() },
        accountant: { role: "accountant", permissions: defaultPermissions() },
        viewer: { role: "viewer", permissions: defaultPermissions() },
      };
      for (const item of json.items ?? []) next[item.role] = item;
      setItems(next);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRole(role: RoleItem["role"]) {
    setSavingRole(role);
    setError(null);
    setOkMsg(null);
    try {
      const res = await apiFetch(`/api/staff/roles-permissions/${role}`, {
        method: "PUT",
        body: JSON.stringify({ permissions: items[role].permissions }),
      });
      if (!res.ok) {
        const raw = await readApiError(res);
        setError(formatStaffApiError(res.status, raw, t));
        return;
      }
      setOkMsg(t("rolesPermissions.saved"));
      await load();
    } finally {
      setSavingRole(null);
    }
  }

  function setRolePermissions(role: RoleItem["role"], value: boolean) {
    setItems((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        permissions: permissionKeys.reduce(
          (acc, key) => ({ ...acc, [key]: value }),
          {} as Record<PermissionKey, boolean>
        ),
      },
    }));
  }

  if (user?.role !== "admin") {
    return <p className="text-sm opacity-70">{t("rolesPermissions.forbidden")}</p>;
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {okMsg ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {okMsg}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("rolesPermissions.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("rolesPermissions.subtitle")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
          {t("common.refresh")}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {roles.map((role) => (
          <Card key={role} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" />
              {t(`rolesPermissions.role.${role}`)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setRolePermissions(role, true)}>
                {t("rolesPermissions.selectAll")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRolePermissions(role, false)}>
                {t("rolesPermissions.clearAll")}
              </Button>
            </div>
            <div className="space-y-3">
              {permissionSections.map((section) => (
                <div key={section.key} className="rounded-lg border border-[hsl(var(--border))] p-3">
                  <div className="mb-2 text-xs font-semibold opacity-70">
                    {t(`rolesPermissions.section.${section.key}`)}
                  </div>
                  <div className="space-y-2">
                    {section.perms.map((perm) => (
                      <label key={perm} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(items[role]?.permissions?.[perm])}
                          onChange={(e) =>
                            setItems((prev) => ({
                              ...prev,
                              [role]: {
                                ...prev[role],
                                permissions: { ...prev[role].permissions, [perm]: e.target.checked },
                              },
                            }))
                          }
                        />
                        {t(`staff.permissions.${perm}`)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => void saveRole(role)} disabled={savingRole === role}>
              <Save className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {savingRole === role ? t("common.loading") : t("common.save")}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
