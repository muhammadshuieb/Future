import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { Card } from "../components/ui/Card";

export function BillingPage() {
  const [inv, setInv] = useState<Record<string, unknown>[]>([]);
  const [pay, setPay] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    void (async () => {
      const [a, b] = await Promise.all([apiFetch("/api/invoices/"), apiFetch("/api/payments/")]);
      if (a.ok) setInv(((await a.json()) as { items: typeof inv }).items);
      if (b.ok) setPay(((await b.json()) as { items: typeof pay }).items);
    })();
  }, []);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      <Card>
        <h2 className="mb-3 font-semibold">Invoices</h2>
        <ul className="space-2 text-sm">
          {inv.slice(0, 40).map((i) => (
            <li key={String(i.id)} className="flex justify-between border-b border-[hsl(var(--border))]/40 py-2">
              <span>{String(i.invoice_no)}</span>
              <span className="opacity-70">
                {String(i.status)} — {String(i.amount)} {String(i.currency ?? "")}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Payments</h2>
        <ul className="space-2 text-sm">
          {pay.slice(0, 40).map((p) => (
            <li key={String(p.id)} className="flex justify-between border-b border-[hsl(var(--border))]/40 py-2">
              <span>{String(p.invoice_no)}</span>
              <span>
                {String(p.amount)} {String(p.currency ?? "")} @ {String(p.paid_at)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
