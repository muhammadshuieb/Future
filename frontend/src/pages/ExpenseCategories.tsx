import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { ActionDialog } from "../components/ui/ActionDialog";
import { TextField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";

type Category = { id: string; name: string; created_at?: string };

export function ExpenseCategoriesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/inventory/categories");
    if (!r.ok) return;
    const j = (await r.json()) as { items: Category[] };
    setItems(j.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCategory() {
    setMessage(null);
    const value = name.trim();
    if (!value) return;
    const res = await apiFetch("/api/inventory/categories", {
      method: "POST",
      body: JSON.stringify({ name: value }),
    });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    setName("");
    await load();
  }

  async function editCategory(item: Category) {
    setMessage(null);
    setEditTarget(item);
    setEditName(item.name);
  }

  async function saveEditCategory() {
    if (!editTarget || !editName.trim()) return;
    const res = await apiFetch(`/api/inventory/categories/${editTarget.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    setEditTarget(null);
    await load();
  }

  async function deleteCategory(item: Category) {
    setDeleteTarget(item);
  }

  async function confirmDeleteCategory() {
    if (!deleteTarget) return;
    const item = deleteTarget;
    setDeleteTarget(null);
    const res = await apiFetch(`/api/inventory/categories/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const raw = await readApiError(res);
      setMessage(formatStaffApiError(res.status, raw, t));
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("expenses.categoriesTitle")}</h1>
      <Card className="sticky-list-panel flex flex-wrap items-end gap-2 p-4">
        <TextField
          label={t("expenses.categoryName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("expenses.categoryName")}
        />
        <Button type="button" onClick={() => void createCategory()}>
          <Plus className="me-2 h-4 w-4" />
          {t("common.add")}
        </Button>
      </Card>
      {message ? <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">{message}</p> : null}
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="sticky-list-table w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">{t("expenses.categoryName")}</th>
                <th className="px-4 py-3 text-left">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} className="border-b border-[hsl(var(--border))]/60">
                  <td className="px-4 py-3">{idx + 1}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => void editCategory(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" className="text-red-600" onClick={() => void deleteCategory(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? <p className="p-6 text-center text-sm opacity-60">{t("expenses.emptyCategories")}</p> : null}
      </Card>
      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title={t("common.edit")}>
        <div className="space-y-3">
          <TextField label={t("expenses.categoryName")} value={editName} onChange={(e) => setEditName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={() => void saveEditCategory()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
      <ActionDialog
        open={Boolean(deleteTarget)}
        title={t("common.delete")}
        message={deleteTarget ? `${t("common.delete")} ${deleteTarget.name}?` : ""}
        variant="danger"
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDeleteCategory();
        }}
      />
    </div>
  );
}
