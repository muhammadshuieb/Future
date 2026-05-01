import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { ActionDialog } from "../components/ui/ActionDialog";
import { SelectField, TextField } from "../components/ui/TextField";
import { apiFetch, formatStaffApiError, readApiError } from "../lib/api";
import { useI18n } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { canManageOperations } from "../lib/permissions";
import { cn } from "../lib/utils";

type Region = {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order?: number | null;
};

type TreeNode = Region & { children: TreeNode[] };

function buildTree(flat: Region[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const r of flat) {
    map.set(r.id, { ...r, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const r of flat) {
    const node = map.get(r.id)!;
    const pid = r.parent_id ?? null;
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function sortRec(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortRec(n.children);
  }
  sortRec(roots);
  return roots;
}

function RegionTree({
  nodes,
  depth,
  onAddChild,
  onDelete,
  canManage,
  isRtl,
}: {
  nodes: TreeNode[];
  depth: number;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string, name: string) => void;
  canManage: boolean;
  isRtl: boolean;
}) {
  const { t } = useI18n();
  return (
    <ul className={cn("space-y-1", depth > 0 && (isRtl ? "me-6 border-e border-[hsl(var(--border))]/50 pe-3" : "ms-6 border-s border-[hsl(var(--border))]/50 ps-3"))}>
      {nodes.map((n) => (
        <li key={n.id} className="rounded-lg bg-[hsl(var(--muted))]/30 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{n.name}</span>
            {canManage ? (
              <div className="flex flex-wrap gap-1">
                <Button type="button" variant="outline" className="px-2 py-1 text-xs" onClick={() => onAddChild(n.id)}>
                  <Plus className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                  {t("subscriberZones.addChild")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1 text-xs text-red-600"
                  onClick={() => onDelete(n.id, n.name)}
                >
                  <Trash2 className={cn("h-3.5 w-3.5", isRtl ? "ms-1" : "me-1")} />
                  {t("common.delete")}
                </Button>
              </div>
            ) : null}
          </div>
          {n.children.length > 0 ? (
            <RegionTree
              nodes={n.children}
              depth={depth + 1}
              onAddChild={onAddChild}
              onDelete={onDelete}
              canManage={canManage}
              isRtl={isRtl}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SubscriberZonesPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const canManage = canManageOperations(user?.role);

  const [items, setItems] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [parentId, setParentId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/regions/");
      if (!res.ok) {
        const raw = await readApiError(res);
        setMsg({ type: "err", text: formatStaffApiError(res.status, raw, t) });
        setItems([]);
        return;
      }
      const json = (await res.json()) as { items: Region[] };
      setItems(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo(() => buildTree(items), [items]);

  const flatOptions = useMemo(() => {
    const byParent = new Map<string | null, Region[]>();
    for (const r of items) {
      const p = r.parent_id ?? null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(r);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    const out: { id: string; label: string }[] = [];
    function walk(parent: string | null, depth: number) {
      for (const r of byParent.get(parent) ?? []) {
        const pad = depth > 0 ? `${"— ".repeat(depth)}` : "";
        out.push({ id: r.id, label: `${pad}${r.name}` });
        walk(r.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [items]);

  function openAddRoot() {
    setParentId("");
    setNewName("");
    setModalError(null);
    setModal(true);
  }

  function openAddChild(id: string) {
    setParentId(id);
    setNewName("");
    setModalError(null);
    setModal(true);
  }

  async function onCreateRegion(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setModalError(null);
    try {
      const r = await apiFetch("/api/regions/", {
        method: "POST",
        body: JSON.stringify({
          name,
          parent_id: parentId || null,
        }),
      });
      if (!r.ok) {
        const raw = await readApiError(r);
        setModalError(formatStaffApiError(r.status, raw, t));
        return;
      }
      setModal(false);
      setMsg({ type: "ok", text: t("common.success") });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!canManage) return;
    setDeleteTarget({ id, name });
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setMsg(null);
    const r = await apiFetch(`/api/regions/${target.id}`, { method: "DELETE" });
    if (!r.ok) {
      const raw = await readApiError(r);
      setMsg({ type: "err", text: formatStaffApiError(r.status, raw, t) });
      return;
    }
    setMsg({ type: "ok", text: t("common.success") });
    await load();
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("subscriberZones.title")}</h1>
          <p className="mt-1 text-sm opacity-70">{t("subscriberZones.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
          {canManage ? (
            <Button type="button" onClick={openAddRoot}>
              <Plus className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
              {t("subscriberZones.addRoot")}
            </Button>
          ) : null}
        </div>
      </div>

      {msg ? (
        <p
          className={cn(
            "rounded-xl px-4 py-2 text-sm",
            msg.type === "err"
              ? "border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
              : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          )}
        >
          {msg.text}
        </p>
      ) : null}

      <Card className="p-4">
        {loading ? (
          <p className="text-sm opacity-70">{t("common.loading")}</p>
        ) : tree.length === 0 ? (
          <p className="text-center text-sm opacity-60">{t("subscriberZones.empty")}</p>
        ) : (
          <RegionTree
            nodes={tree}
            depth={0}
            onAddChild={openAddChild}
            onDelete={onDelete}
            canManage={canManage}
            isRtl={isRtl}
          />
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => {
          setModalError(null);
          setModal(false);
        }}
        title={parentId ? t("subscriberZones.addChild") : t("subscriberZones.addRoot")}
        wide
      >
        <form onSubmit={onCreateRegion} className="space-y-4">
          {modalError ? (
            <div className="whitespace-pre-wrap rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {modalError}
            </div>
          ) : null}
          <SelectField label={t("subscriberZones.parent")} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("subscriberZones.noParent")}</option>
            {flatOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </SelectField>
          <TextField label={t("subscriberZones.regionName")} value={newName} onChange={(e) => setNewName(e.target.value)} required />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setModalError(null);
                setModal(false);
              }}
            >
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
        message={deleteTarget ? `${t("subscriberZones.deleteConfirm")}\n${deleteTarget.name}` : ""}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete();
        }}
      />
    </div>
  );
}
