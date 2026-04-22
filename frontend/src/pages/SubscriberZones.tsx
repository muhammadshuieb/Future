import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { useI18n } from "../context/LocaleContext";

type Subscriber = {
  id: string;
  address?: string | null;
  nas_name?: string | null;
};

export function SubscriberZonesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Subscriber[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await apiFetch("/api/subscribers/");
      if (!res.ok) return;
      const json = (await res.json()) as { items: Subscriber[] };
      setItems(json.items ?? []);
    })();
  }, []);

  const zones = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of items) {
      const zone = String(row.address ?? row.nas_name ?? "").trim() || t("subscriberZones.unknown");
      map.set(zone, (map.get(zone) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items, t]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("subscriberZones.title")}</h1>
      <p className="text-sm opacity-70">{t("subscriberZones.subtitle")}</p>
      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-xs uppercase opacity-70">
              <th className="px-4 py-3 text-left">{t("subscriberZones.zone")}</th>
              <th className="px-4 py-3 text-left">{t("subscriberZones.count")}</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.name} className="border-b border-[hsl(var(--border))]/60">
                <td className="px-4 py-3">{z.name}</td>
                <td className="px-4 py-3">{z.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {zones.length === 0 ? <p className="p-6 text-center text-sm opacity-60">{t("subscriberZones.empty")}</p> : null}
      </Card>
    </div>
  );
}
