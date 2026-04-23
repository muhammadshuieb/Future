import { useCallback, useEffect, useState } from "react";
import { Download, FileText, KeyRound, Layers, Printer, Users } from "lucide-react";
import { apiFetch, readApiError, formatStaffApiError } from "../lib/api";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { TextField, SelectField } from "../components/ui/TextField";
import { useI18n } from "../context/LocaleContext";
import { canManageOperations } from "../lib/permissions";
import { useAuth } from "../context/AuthContext";
import { cn } from "../lib/utils";

type Pkg = { id: string; name: string };
type Nas = { id: string; name: string; ip: string };

function randomDigits(len: number): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < len; i++) s += String(a[i]! % 10);
  if (s[0] === "0" && len > 1) s = "1" + s.slice(1);
  return s;
}

type Row = { serial: number; card_name: string; username: string; password: string; package: string };
type Created = { id: string; username: string };

export function CardBatchPage() {
  const { t, isRtl } = useI18n();
  const { user } = useAuth();
  const can = canManageOperations(user?.role);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [nasList, setNasList] = useState<Nas[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [count, setCount] = useState(20);
  const [userLen, setUserLen] = useState(8);
  const [passLen, setPassLen] = useState(8);
  const [prefix, setPrefix] = useState("C");
  const [packageId, setPackageId] = useState("");
  const [nasId, setNasId] = useState("");
  const [working, setWorking] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [created, setCreated] = useState<Created[]>([]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [a, b] = await Promise.all([apiFetch("/api/packages/"), apiFetch("/api/nas/")]);
      if (a.ok) {
        const j = (await a.json()) as { items?: { id: string; name: string }[] };
        setPackages((j.items ?? []).map((x) => ({ id: x.id, name: x.name })));
      }
      if (b.ok) {
        const j = (await b.json()) as { nas_servers: Nas[] };
        setNasList(
          (j.nas_servers ?? []).map((n) => ({
            id: String(n.id),
            name: String(n.name),
            ip: String(n.ip),
          }))
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pkgName = (id: string) => packages.find((p) => p.id === id)?.name ?? "—";

  function buildPreview() {
    setErr(null);
    setMsg(null);
    setCreated([]);
    const n = Math.max(1, Math.min(500, Math.floor(count) || 1));
    const uLen = Math.max(4, Math.min(16, userLen));
    const pLen = Math.max(4, Math.min(16, passLen));
    const pfx = String(prefix).replace(/[^\dA-Za-z\-_]/g, "").slice(0, 20) || "C";
    const out: Row[] = [];
    const used = new Set<string>();
    for (let i = 1; i <= n; i++) {
      let u = randomDigits(uLen);
      let guard = 0;
      while (used.has(u) && guard++ < 50) u = randomDigits(uLen);
      used.add(u);
      const pass = randomDigits(pLen);
      out.push({
        serial: i,
        card_name: `${pfx}-${String(i).padStart(String(n).length, "0")}`,
        username: u,
        password: pass,
        package: pkgName(packageId),
      });
    }
    setRows(out);
  }

  async function createInSystem() {
    if (!packageId) {
      setErr(t("cardBatch.selectPackage"));
      return;
    }
    if (rows.length === 0) {
      setErr(t("cardBatch.generateFirst"));
      return;
    }
    setWorking(true);
    setErr(null);
    setMsg(null);
    try {
      const body = {
        items: rows.map((r) => ({
          username: r.username,
          password: r.password,
          package_id: packageId,
          nas_server_id: nasId || null,
        })),
      };
      const r = await apiFetch("/api/subscribers/bulk", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) {
        const raw = await readApiError(r);
        setErr(formatStaffApiError(r.status, raw, t));
        return;
      }
      const j = (await r.json()) as { created: Created[]; errors: { username: string; error: string }[] };
      setCreated(j.created ?? []);
      if (j.errors?.length) {
        setErr(j.errors.map((e) => `${e.username}: ${e.error}`).join("\n"));
      } else {
        setMsg(t("cardBatch.created").replace("{n}", String(j.created?.length ?? 0)));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  function toCsv() {
    const header = "serial,card_name,username,password,package";
    const lines = rows.map(
      (r) =>
        `${r.serial},"${r.card_name.replace(/"/g, '""')}",${r.username},${r.password},"${r.package.replace(/"/g, '""')}"`
    );
    return [header, ...lines].join("\n");
  }

  function downloadCsv() {
    const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cards.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printCards() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cards</title>
    <style>
      @media print { .card { break-inside: avoid; page-break-inside: avoid; } }
      body { font-family: system-ui, sans-serif; padding: 16px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .card { border: 1px solid #ccc; border-radius: 12px; padding: 12px; }
      h2 { margin: 0 0 8px; font-size: 14px; }
      .row { font-size: 12px; margin: 4px 0; }
      .mono { font-family: ui-monospace, monospace; }
    </style></head><body>
    <p>${t("cardBatch.printHint")}</p>
    <div class="grid">
    ${rows
      .map(
        (r) => `<div class="card"><h2>${r.card_name}</h2>
      <div class="row">${t("cardBatch.colUser")}: <span class="mono">${r.username}</span></div>
      <div class="row">${t("cardBatch.colPass")}: <span class="mono">${r.password}</span></div>
      <div class="row">${t("cardBatch.colPkg")}: ${r.package}</div>
      <div class="row">#${r.serial}</div></div>`
      )
      .join("")}
    </div>
    <script>window.onload = function() { window.print(); }</script>
    </body></html>`);
    w.document.close();
  }

  if (!can) {
    return (
      <div className="p-6">
        <p className="text-sm opacity-70">{t("api.error_403")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("cardBatch.title")}</h1>
        <p className="mt-1 text-sm opacity-70">{t("cardBatch.subtitle")}</p>
      </div>

      {err ? (
        <p className="whitespace-pre-wrap rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {err}
        </p>
      ) : null}
      {msg ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {msg}
        </p>
      ) : null}

      <Card className="space-y-4 p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Layers className="h-4 w-4 text-violet-500" />
          {t("cardBatch.options")}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("cardBatch.count")}
            type="number"
            min={1}
            max={500}
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
          />
          <TextField
            label={t("cardBatch.prefix")}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <TextField
            label={t("cardBatch.userDigits")}
            type="number"
            min={4}
            max={16}
            value={String(userLen)}
            onChange={(e) => setUserLen(Number(e.target.value) || 8)}
          />
          <TextField
            label={t("cardBatch.passDigits")}
            type="number"
            min={4}
            max={16}
            value={String(passLen)}
            onChange={(e) => setPassLen(Number(e.target.value) || 8)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("cardBatch.package")}
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            required
          >
            <option value="">{t("common.none")}</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("cardBatch.nasOptional")}
            value={nasId}
            onChange={(e) => setNasId(e.target.value)}
          >
            <option value="">{t("common.none")}</option>
            {nasList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({n.ip})
              </option>
            ))}
          </SelectField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={buildPreview}>
            <KeyRound className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("cardBatch.generate")}
          </Button>
          <Button type="button" variant="soft" onClick={createInSystem} disabled={working || rows.length === 0}>
            <Users className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {working ? t("common.loading") : t("cardBatch.createUsers")}
          </Button>
          <Button type="button" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
            <Download className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("cardBatch.csv")}
          </Button>
          <Button type="button" variant="outline" onClick={printCards} disabled={rows.length === 0}>
            <Printer className={cn("h-4 w-4", isRtl ? "ms-2" : "me-2")} />
            {t("cardBatch.pdfPrint")}
          </Button>
        </div>
        <p className="text-xs opacity-60">{t("cardBatch.hint")}</p>
      </Card>

      {rows.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-[hsl(var(--border))] px-4 py-2 text-sm font-medium">
            <FileText className="me-1 inline h-4 w-4" />
            {t("cardBatch.preview")} ({rows.length}
            {created.length ? ` · ${t("cardBatch.added")}: ${created.length}` : ""})
          </div>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-[hsl(var(--muted))]/40 text-xs uppercase opacity-70">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">{t("cardBatch.colCard")}</th>
                <th className="px-2 py-2">{t("cardBatch.colUser")}</th>
                <th className="px-2 py-2">{t("cardBatch.colPass")}</th>
                <th className="px-2 py-2">{t("cardBatch.colPkg")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.serial} className="border-t border-[hsl(var(--border))]/50">
                  <td className="px-2 py-1 font-mono">{r.serial}</td>
                  <td className="px-2 py-1 font-mono">{r.card_name}</td>
                  <td className="px-2 py-1 font-mono">{r.username}</td>
                  <td className="px-2 py-1 font-mono">{r.password}</td>
                  <td className="px-2 py-1">{r.package}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
