import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Package,
  Server,
  Activity,
  Radio,
  Boxes,
  Shield,
  Settings,
  Wrench,
  MessageCircle,
  ChevronDown,
  Link2,
  FileText,
  Send,
  ListChecks,
  UserCog,
  ClipboardList,
  LogOut,
  Moon,
  Sun,
  UserCircle,
  Languages,
  Wifi,
  MapPin,
  ReceiptText,
  Gauge,
  FolderKanban,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Tailwind color classes: text, ring/bg tint */
  tone: ToneKey;
};

type ToneKey =
  | "indigo"
  | "cyan"
  | "emerald"
  | "amber"
  | "orange"
  | "slate"
  | "blue"
  | "violet"
  | "pink"
  | "green"
  | "purple"
  | "teal"
  | "yellow"
  | "rose"
  | "fuchsia"
  | "sky";

// Mapping must use static class names so Tailwind doesn't purge them.
const tones: Record<ToneKey, { text: string; bg: string; activeFrom: string; activeTo: string }> = {
  indigo: { text: "text-indigo-500", bg: "bg-indigo-500/10", activeFrom: "from-indigo-500", activeTo: "to-indigo-600" },
  cyan: { text: "text-cyan-500", bg: "bg-cyan-500/10", activeFrom: "from-cyan-500", activeTo: "to-cyan-600" },
  emerald: { text: "text-emerald-500", bg: "bg-emerald-500/10", activeFrom: "from-emerald-500", activeTo: "to-emerald-600" },
  amber: { text: "text-amber-500", bg: "bg-amber-500/10", activeFrom: "from-amber-500", activeTo: "to-amber-600" },
  orange: { text: "text-orange-500", bg: "bg-orange-500/10", activeFrom: "from-orange-500", activeTo: "to-orange-600" },
  slate: { text: "text-slate-500", bg: "bg-slate-500/10", activeFrom: "from-slate-500", activeTo: "to-slate-700" },
  blue: { text: "text-blue-500", bg: "bg-blue-500/10", activeFrom: "from-blue-500", activeTo: "to-blue-600" },
  violet: { text: "text-violet-500", bg: "bg-violet-500/10", activeFrom: "from-violet-500", activeTo: "to-violet-600" },
  pink: { text: "text-pink-500", bg: "bg-pink-500/10", activeFrom: "from-pink-500", activeTo: "to-pink-600" },
  green: { text: "text-green-500", bg: "bg-green-500/10", activeFrom: "from-green-500", activeTo: "to-green-600" },
  purple: { text: "text-purple-500", bg: "bg-purple-500/10", activeFrom: "from-purple-500", activeTo: "to-purple-600" },
  teal: { text: "text-teal-500", bg: "bg-teal-500/10", activeFrom: "from-teal-500", activeTo: "to-teal-600" },
  yellow: { text: "text-yellow-500", bg: "bg-yellow-500/10", activeFrom: "from-yellow-500", activeTo: "to-yellow-600" },
  rose: { text: "text-rose-500", bg: "bg-rose-500/10", activeFrom: "from-rose-500", activeTo: "to-rose-600" },
  fuchsia: { text: "text-fuchsia-500", bg: "bg-fuchsia-500/10", activeFrom: "from-fuchsia-500", activeTo: "to-fuchsia-600" },
  sky: { text: "text-sky-500", bg: "bg-sky-500/10", activeFrom: "from-sky-500", activeTo: "to-sky-600" },
};

function IconTile({
  Icon,
  tone,
  active,
  small,
}: {
  Icon: LucideIcon;
  tone: ToneKey;
  active: boolean;
  small?: boolean;
}) {
  const t = tones[tone];
  const size = small ? "h-7 w-7" : "h-8 w-8";
  return (
    <span
      className={cn(
        "icon-tile transition-all",
        size,
        active ? "bg-white/25 text-white shadow-inner" : cn(t.bg, t.text)
      )}
      aria-hidden
    >
      <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </span>
  );
}

function itemClass(active: boolean, tone: ToneKey, small = false) {
  const t = tones[tone];
  return cn(
    "group relative flex w-full items-center gap-3 rounded-xl text-sm font-medium transition-all",
    small ? "ms-3 px-2.5 py-1.5" : "px-2.5 py-2",
    active
      ? cn(
          "bg-gradient-to-r text-white shadow-md",
          t.activeFrom,
          t.activeTo,
          "shadow-[0_8px_24px_-10px]"
        )
      : "text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]/60 hover:text-[hsl(var(--foreground))]"
  );
}

export function AdminShell() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t, locale, setLocale, isRtl } = useI18n();
  const location = useLocation();
  const canManageWhatsApp = user?.role === "admin" || user?.role === "manager";
  const isSubscribersRoute =
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/packages") ||
    location.pathname.startsWith("/billing") ||
    location.pathname.startsWith("/subscriber-zones") ||
    location.pathname.startsWith("/online-users");
  const isStaffRoute = location.pathname.startsWith("/staff");
  const isInventoryRoute = location.pathname.startsWith("/inventory");
  const isWhatsAppRoute = location.pathname.startsWith("/whatsapp");
  const [subscribersOpen, setSubscribersOpen] = useState(isSubscribersRoute);
  const [staffOpen, setStaffOpen] = useState(isStaffRoute);
  const [inventoryOpen, setInventoryOpen] = useState(isInventoryRoute);
  const [whatsAppOpen, setWhatsAppOpen] = useState(isWhatsAppRoute);

  useEffect(() => {
    if (isSubscribersRoute) setSubscribersOpen(true);
  }, [isSubscribersRoute]);
  useEffect(() => {
    if (isWhatsAppRoute) setWhatsAppOpen(true);
  }, [isWhatsAppRoute]);
  useEffect(() => {
    if (isStaffRoute) setStaffOpen(true);
  }, [isStaffRoute]);
  useEffect(() => {
    if (isInventoryRoute) setInventoryOpen(true);
  }, [isInventoryRoute]);

  const nav: NavItem[] = [
    { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, tone: "indigo" },
    { to: "/nas", labelKey: "nav.nas", icon: Server, tone: "cyan" },
    { to: "/accounting", labelKey: "nav.accounting", icon: Activity, tone: "emerald" },
    { to: "/observability", labelKey: "nav.observability", icon: Gauge, tone: "amber" },
    ...((user?.role === "admin" || user?.role === "manager")
      ? ([{ to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench, tone: "orange" }] as NavItem[])
      : []),
    { to: "/settings", labelKey: "nav.settings", icon: Settings, tone: "slate" },
  ];
  const whatsappNav: NavItem[] = [
    { to: "/whatsapp/connection", labelKey: "nav.whatsappConnection", icon: Link2, tone: "green" },
    { to: "/whatsapp/templates", labelKey: "nav.whatsappTemplates", icon: FileText, tone: "indigo" },
    { to: "/whatsapp/broadcast", labelKey: "nav.whatsappBroadcast", icon: Send, tone: "pink" },
    { to: "/whatsapp/logs", labelKey: "nav.whatsappLogs", icon: ListChecks, tone: "slate" },
  ];
  const staffNav: NavItem[] = [
    { to: "/staff", labelKey: "nav.staffUsers", icon: Users, tone: "purple" },
    { to: "/staff/roles-permissions", labelKey: "nav.rolesPermissions", icon: UserCog, tone: "amber" },
    { to: "/staff/audit", labelKey: "nav.auditLogs", icon: ClipboardList, tone: "teal" },
  ];
  const inventoryNav: NavItem[] = [
    { to: "/inventory/categories", labelKey: "nav.expenseCategories", icon: Tag, tone: "yellow" },
    { to: "/inventory/expenses", labelKey: "nav.expenses", icon: Boxes, tone: "orange" },
  ];
  const subscribersNav: NavItem[] = [
    { to: "/packages", labelKey: "nav.subscriberPlans", icon: Package, tone: "violet" },
    { to: "/subscriber-zones", labelKey: "nav.subscriberZones", icon: MapPin, tone: "rose" },
    { to: "/users", labelKey: "nav.subscribersItem", icon: Wifi, tone: "blue" },
    { to: "/online-users", labelKey: "nav.onlineUsers", icon: Radio, tone: "green" },
    { to: "/billing", labelKey: "nav.invoicesItem", icon: ReceiptText, tone: "emerald" },
  ];

  return (
    <div className="flex min-h-screen text-[hsl(var(--foreground))]" dir={isRtl ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <aside className="glass sticky top-0 flex h-screen w-72 flex-col border-0 border-e border-[hsl(var(--border))]/70 rounded-none">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-sm font-bold text-white shadow-glow">
            FR
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight">{t("app.name")}</div>
            <div className="truncate text-xs opacity-60">{t("app.tagline")}</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {nav.map(({ to, labelKey, icon: Icon, tone }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => itemClass(isActive, tone)}
            >
              {({ isActive }) => (
                <>
                  <IconTile Icon={Icon} tone={tone} active={isActive} />
                  <span className="truncate">{t(labelKey)}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* Subscribers group */}
          <GroupButton
            open={subscribersOpen}
            onToggle={() => setSubscribersOpen((v) => !v)}
            active={isSubscribersRoute}
            label={t("nav.subscribersGroup")}
            Icon={Wifi}
            tone="blue"
          />
          {subscribersOpen
            ? subscribersNav.map(({ to, labelKey, icon: Icon, tone }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => itemClass(isActive, tone, true)}
                >
                  {({ isActive }) => (
                    <>
                      <IconTile Icon={Icon} tone={tone} active={isActive} small />
                      <span className="truncate">{t(labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))
            : null}

          {/* Staff group (admin-only) */}
          {user?.role === "admin" ? (
            <>
              <GroupButton
                open={staffOpen}
                onToggle={() => setStaffOpen((v) => !v)}
                active={isStaffRoute}
                label={t("nav.staff")}
                Icon={Shield}
                tone="purple"
              />
              {staffOpen
                ? staffNav.map(({ to, labelKey, icon: Icon, tone }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === "/staff"}
                      className={({ isActive }) => itemClass(isActive, tone, true)}
                    >
                      {({ isActive }) => (
                        <>
                          <IconTile Icon={Icon} tone={tone} active={isActive} small />
                          <span className="truncate">{t(labelKey)}</span>
                        </>
                      )}
                    </NavLink>
                  ))
                : null}
            </>
          ) : null}

          {/* Expenses group */}
          <GroupButton
            open={inventoryOpen}
            onToggle={() => setInventoryOpen((v) => !v)}
            active={isInventoryRoute}
            label={t("nav.expensesGroup")}
            Icon={FolderKanban}
            tone="orange"
          />
          {inventoryOpen
            ? inventoryNav.map(({ to, labelKey, icon: Icon, tone }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => itemClass(isActive, tone, true)}
                >
                  {({ isActive }) => (
                    <>
                      <IconTile Icon={Icon} tone={tone} active={isActive} small />
                      <span className="truncate">{t(labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))
            : null}

          {/* WhatsApp group */}
          {canManageWhatsApp ? (
            <>
              <GroupButton
                open={whatsAppOpen}
                onToggle={() => setWhatsAppOpen((v) => !v)}
                active={isWhatsAppRoute}
                label={t("nav.whatsapp")}
                Icon={MessageCircle}
                tone="green"
              />
              {whatsAppOpen
                ? whatsappNav.map(({ to, labelKey, icon: Icon, tone }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) => itemClass(isActive, tone, true)}
                    >
                      {({ isActive }) => (
                        <>
                          <IconTile Icon={Icon} tone={tone} active={isActive} small />
                          <span className="truncate">{t(labelKey)}</span>
                        </>
                      )}
                    </NavLink>
                  ))
                : null}
            </>
          ) : null}
        </nav>

        <a
          href="/user/login"
          className="mx-3 mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[hsl(var(--foreground))]/70 hover:bg-[hsl(var(--muted))]/60 hover:text-[hsl(var(--foreground))]"
        >
          <span className="icon-tile h-7 w-7 bg-sky-500/10 text-sky-500">
            <UserCircle className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{t("nav.userPortal")}</span>
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="glass sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 rounded-none border-0 border-b border-[hsl(var(--border))]/70 px-6 py-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[hsl(var(--primary))]/20 to-[hsl(var(--accent))]/20 text-[hsl(var(--primary))]">
              <UserCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs opacity-60">{t("header.signedIn")}</div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{user?.name || user?.email}</span>
                <span className="rounded-full bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--primary))]">
                  {user?.role}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-[hsl(var(--muted))]/60"
              title={t("nav.lang")}
            >
              <Languages className="h-4 w-4 text-violet-500" />
              <span className="hidden sm:inline">{t("nav.lang")}</span>
            </button>
            <button
              type="button"
              onClick={toggle}
              className="rounded-xl p-2 transition hover:bg-[hsl(var(--muted))]/60"
              aria-label={t("header.theme")}
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5 text-amber-400" />
              ) : (
                <Moon className="h-5 w-5 text-indigo-500" />
              )}
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition hover:bg-red-500/10 hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t("header.logout")}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GroupButton({
  open,
  onToggle,
  active,
  label,
  Icon,
  tone,
}: {
  open: boolean;
  onToggle: () => void;
  active: boolean;
  label: string;
  Icon: LucideIcon;
  tone: ToneKey;
}) {
  return (
    <button type="button" onClick={onToggle} className={itemClass(active, tone)}>
      <IconTile Icon={Icon} tone={tone} active={active} />
      <span className="flex-1 truncate text-start">{label}</span>
      <ChevronDown className={cn("h-4 w-4 opacity-70 transition-transform", open ? "rotate-180" : "rotate-0")} />
    </button>
  );
}
