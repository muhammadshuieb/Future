import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { Card } from "../components/ui/Card";

export function InventoryPage() {
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    void (async () => {
      const r = await apiFetch("/api/inventory/products");
      if (r.ok) setProducts(((await r.json()) as { items: typeof products }).items);
    })();
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Inventory</h1>
      <div className="grid gap-4 md:grid-cols-3">
        {products.map((p) => (
          <Card key={String(p.id)}>
            <div className="font-semibold">{String(p.name)}</div>
            <div className="text-xs opacity-70">SKU {String(p.sku)}</div>
            <div className="mt-2 text-sm">Stock: {String(p.stock_qty)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
