import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { FileText, MoreHorizontal, Pencil, Power, Trash2, User, Wallet } from "lucide-react";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

export type SubscriberRowActionsProps = {
  subscriberId: string;
  username: string;
  isRtl: boolean;
  canManage: boolean;
  canFinance: boolean;
  accountDisabled: boolean;
  toggleLoading: boolean;
  reportLoading: boolean;
  labels: {
    menu: string;
    viewProfile: string;
    edit: string;
    payment: string;
    financialReport: string;
    enable: string;
    disable: string;
    delete: string;
  };
  onPayment: () => void;
  onFinancialReport: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
};

type MenuCoords = { top: number; left: number };

const VIEWPORT_PAD = 8;
const MENU_WIDTH_FALLBACK = 260;

/** Keep a fixed menu fully inside the viewport; prefer aligning its trailing edge to the button's trailing edge. */
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

export function SubscriberRowActions({
  subscriberId,
  username,
  isRtl,
  canManage,
  canFinance,
  accountDisabled,
  toggleLoading,
  reportLoading,
  labels,
  onPayment,
  onFinancialReport,
  onToggleStatus,
  onDelete,
}: SubscriberRowActionsProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const [menuCoords, setMenuCoords] = useState<MenuCoords | null>(null);

  const updateMenuCoords = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const measured =
      menuPanelRef.current?.getBoundingClientRect().width ?? menuPanelRef.current?.offsetWidth ?? 0;
    const menuWidth = Math.max(MENU_WIDTH_FALLBACK, measured);
    const left = clampMenuLeft(r, menuWidth);
    setMenuCoords({ top: r.bottom + gap, left });
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
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuPanelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const menu = open && menuCoords ? (
    <div
      ref={menuPanelRef}
      role="menu"
      dir={isRtl ? "rtl" : "ltr"}
      className={cn(
        "fixed z-[300] min-w-[11.5rem] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 text-xs shadow-lg"
      )}
      style={{
        top: menuCoords.top,
        left: menuCoords.left,
        maxWidth: `min(22rem, calc(100vw - ${VIEWPORT_PAD * 2}px))`,
      }}
    >
      <Link
        role="menuitem"
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--muted))]/60"
        to={`/users/${subscriberId}`}
        onClick={() => setOpen(false)}
      >
        <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {labels.viewProfile}
      </Link>
      <Link
        role="menuitem"
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--muted))]/60"
        to={`/users/${subscriberId}`}
        onClick={() => setOpen(false)}
      >
        <Pencil className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {labels.edit}
      </Link>
      {canFinance ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-[hsl(var(--muted))]/60"
            onClick={() => {
              setOpen(false);
              onPayment();
            }}
          >
            <Wallet className="h-3.5 w-3.5 shrink-0 opacity-70" />
            {labels.payment}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-[hsl(var(--muted))]/60"
            disabled={reportLoading}
            onClick={() => {
              setOpen(false);
              onFinancialReport();
            }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
            {reportLoading ? "…" : labels.financialReport}
          </button>
        </>
      ) : null}
      {canManage ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-[hsl(var(--muted))]/60"
            disabled={toggleLoading}
            onClick={() => {
              setOpen(false);
              onToggleStatus();
            }}
          >
            <Power className="h-3.5 w-3.5 shrink-0 opacity-70" />
            {toggleLoading ? "…" : accountDisabled ? labels.enable : labels.disable}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-red-600 hover:bg-red-500/10 dark:text-red-400"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            {labels.delete}
          </button>
        </>
      ) : null}
      {!canManage && !canFinance ? (
        <div className="px-3 py-1.5 text-[10px] opacity-60">{username}</div>
      ) : null}
    </div>
  ) : null;

  return (
    <span ref={anchorRef} className="inline-flex align-middle">
      <Button
        type="button"
        variant="outline"
        className="h-8 min-w-[2.25rem] px-2 py-0"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={labels.menu}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4 opacity-80" />
      </Button>
      {menu ? createPortal(menu, document.body) : null}
    </span>
  );
}
