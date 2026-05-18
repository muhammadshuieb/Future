import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useI18n } from "../../context/LocaleContext";

export type ColumnOption = {
  key: string;
  label: string;
  defaultVisible?: boolean;
};

function storageKey(pageKey: string): string {
  return `fr:table-columns:${pageKey}`;
}

const VIEWPORT_PAD = 8;
const MENU_WIDTH = 256;

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

type MenuCoords = { top: number; left: number; maxHeight: number };

function clampMenuLeft(anchor: DOMRect, menuWidth: number): number {
  const vw = window.innerWidth;
  const maxLeft = vw - VIEWPORT_PAD - menuWidth;
  let left = anchor.right - menuWidth;
  if (left < VIEWPORT_PAD) {
    left = anchor.left;
  }
  if (left > maxLeft) {
    left = Math.max(VIEWPORT_PAD, maxLeft);
  }
  if (left < VIEWPORT_PAD) {
    left = VIEWPORT_PAD;
  }
  return left;
}

export function ColumnVisibilityMenu(props: {
  title: string;
  columns: ColumnOption[];
  visibleKeys: string[];
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onResetDefault: () => void;
}) {
  const { t, isRtl } = useI18n();
  const { title, columns, visibleKeys, onToggle, onShowAll, onResetDefault } = props;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [menuCoords, setMenuCoords] = useState<MenuCoords | null>(null);

  const updateMenuCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const panel = panelRef.current;
    const measuredH = panel?.getBoundingClientRect().height ?? panel?.offsetHeight ?? 320;
    const menuHeight = Math.min(measuredH, window.innerHeight - VIEWPORT_PAD * 2);
    const left = clampMenuLeft(r, MENU_WIDTH);

    const spaceBelow = window.innerHeight - VIEWPORT_PAD - (r.bottom + gap);
    const spaceAbove = r.top - gap - VIEWPORT_PAD;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    let top: number;
    if (openUp) {
      top = Math.max(VIEWPORT_PAD, r.top - gap - menuHeight);
    } else {
      top = r.bottom + gap;
      if (top + menuHeight > window.innerHeight - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, window.innerHeight - VIEWPORT_PAD - menuHeight);
      }
    }

    setMenuCoords({ top, left, maxHeight: Math.max(160, window.innerHeight - VIEWPORT_PAD * 2) });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuCoords(null);
      return;
    }
    updateMenuCoords();
    const id = window.requestAnimationFrame(() => updateMenuCoords());
    const onReposition = () => updateMenuCoords();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuCoords]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const menu =
    open && menuCoords
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={title}
            dir={isRtl ? "rtl" : "ltr"}
            className="fixed z-[300] w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-xl"
            style={{
              top: menuCoords.top,
              left: menuCoords.left,
              maxWidth: `min(${MENU_WIDTH}px, calc(100vw - ${VIEWPORT_PAD * 2}px))`,
              maxHeight: menuCoords.maxHeight,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div className="mb-2 shrink-0 text-xs font-semibold opacity-70">{title}</div>
            <div className="mb-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {columns.map((col) => {
                const checked = visibleKeys.includes(col.key);
                return (
                  <label
                    key={col.key}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[hsl(var(--muted))]/40",
                      checked ? "opacity-100" : "opacity-80"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(col.key)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="select-none">{col.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[hsl(var(--border))]/50 pt-2">
              <button
                type="button"
                className="rounded-md border border-[hsl(var(--border))] px-2 py-1.5 text-xs hover:bg-[hsl(var(--muted))]/40"
                onClick={onShowAll}
              >
                {t("table.showAllColumns")}
              </button>
              <button
                type="button"
                className="rounded-md border border-[hsl(var(--border))] px-2 py-1.5 text-xs hover:bg-[hsl(var(--muted))]/40"
                onClick={onResetDefault}
              >
                {t("table.resetColumnsDefault")}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm hover:bg-[hsl(var(--muted))]/40"
      >
        <Columns3 className="h-4 w-4 shrink-0" />
        {title}
      </button>
      {menu}
    </>
  );
}
