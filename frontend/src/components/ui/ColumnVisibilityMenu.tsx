import { useEffect, useMemo, useState } from "react";
import { Columns3 } from "lucide-react";
import { cn } from "../../lib/utils";

export type ColumnOption = {
  key: string;
  label: string;
  defaultVisible?: boolean;
};

function storageKey(pageKey: string): string {
  return `fr:table-columns:${pageKey}`;
}

export function useColumnVisibility(pageKey: string, columns: ColumnOption[]) {
  const allKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const defaultVisible = useMemo(
    () => columns.filter((c) => c.defaultVisible !== false).map((c) => c.key),
    [columns]
  );

  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisible);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(pageKey));
      if (!raw) {
        setVisibleKeys(defaultVisible);
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      const safe = parsed.filter((k) => allKeys.includes(k));
      setVisibleKeys(safe.length > 0 ? safe : defaultVisible);
    } catch {
      setVisibleKeys(defaultVisible);
    }
  }, [allKeys, defaultVisible, pageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(pageKey), JSON.stringify(visibleKeys));
    } catch {
      // ignore storage errors
    }
  }, [pageKey, visibleKeys]);

  function toggle(key: string) {
    setVisibleKeys((current) => {
      if (current.includes(key)) {
        const next = current.filter((k) => k !== key);
        return next.length > 0 ? next : current;
      }
      return [...current, key];
    });
  }

  function showAll() {
    setVisibleKeys(allKeys);
  }

  function resetDefault() {
    setVisibleKeys(defaultVisible);
  }

  return {
    visibleKeys,
    isVisible: (key: string) => visibleKeys.includes(key),
    toggle,
    showAll,
    resetDefault,
  };
}

export function ColumnVisibilityMenu(props: {
  title: string;
  columns: ColumnOption[];
  visibleKeys: string[];
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onResetDefault: () => void;
}) {
  const { title, columns, visibleKeys, onToggle, onShowAll, onResetDefault } = props;

  return (
    <details className="relative">
      <summary className="list-none">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm hover:bg-[hsl(var(--muted))]/40"
        >
          <Columns3 className="h-4 w-4" />
          {title}
        </button>
      </summary>
      <div className="absolute z-30 mt-2 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-xl">
        <div className="mb-2 text-xs font-semibold opacity-70">{title}</div>
        <div className="mb-3 max-h-64 space-y-1 overflow-auto">
          {columns.map((col) => {
            const checked = visibleKeys.includes(col.key);
            return (
              <label
                key={col.key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[hsl(var(--muted))]/40",
                  checked ? "opacity-100" : "opacity-80"
                )}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggle(col.key)} />
                <span>{col.label}</span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs hover:bg-[hsl(var(--muted))]/40"
            onClick={onShowAll}
          >
            إظهار الكل
          </button>
          <button
            type="button"
            className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs hover:bg-[hsl(var(--muted))]/40"
            onClick={onResetDefault}
          >
            افتراضي
          </button>
        </div>
      </div>
    </details>
  );
}
