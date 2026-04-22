import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Package,
  CreditCard,
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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useI18n } from "../context/LocaleContext";
import { cn } from "../lib/utils";

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

  const nav = [
    { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
    { to: "/nas", labelKey: "nav.nas", icon: Server },
    { to: "/accounting", labelKey: "nav.accounting", icon: Activity },
    { to: "/observability", labelKey: "nav.observability", icon: Gauge },
    ...((user?.role === "admin" || user?.role === "manager")
      ? [{ to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench }]
      : []),
    { to: "/settings", labelKey: "nav.settings", icon: Settings },
  ];
  const whatsappNav = [
    { to: "/whatsapp/connection", labelKey: "nav.whatsappConnection", icon: Link2 },
    { to: "/whatsapp/templates", labelKey: "nav.whatsappTemplates", icon: FileText },
    { to: "/whatsapp/broadcast", labelKey: "nav.whatsappBroadcast", icon: Send },
    { to: "/whatsapp/logs", labelKey: "nav.whatsappLogs", icon: ListChecks },
  ];
  const staffNav = [
    { to: "/staff", labelKey: "nav.staffUsers", icon: Users },
    { to: "/staff/roles-permissions", labelKey: "nav.rolesPermissions", icon: UserCog },
    { to: "/staff/audit", labelKey: "nav.auditLogs", icon: ClipboardList },
  ];
  const inventoryNav = [
    { to: "/inventory/categories", labelKey: "nav.expenseCategories", icon: FileText },
    { to: "/inventory/expenses", labelKey: "nav.expenses", icon: Boxes },
  ];
  const subscribersNav = [
    { to: "/packages", labelKey: "nav.subscriberPlans", icon: Package },
    { to: "/subscriber-zones", labelKey: "nav.subscriberZones", icon: MapPin },
    { to: "/users", labelKey: "nav.subscribersItem", icon: Wifi },
    { to: "/online-users", labelKey: "nav.onlineUsers", icon: Radio },
    { to: "/billing", labelKey: "nav.invoicesItem", icon: ReceiptText },
  ];

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))]" dir={isRtl ? "rtl" : "ltr"}>
      <aside className="flex w-64 flex-col border-e border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
        <div className="mb-6 flex items-center gap-3 px-4 pt-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-sm font-bold text-white">
            FR
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{t("app.name")}</div>
            <div className="truncate text-xs opacity-60">{t("app.tagline")}</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {nav.map(({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive
                    ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                    : "text-[hsl(var(--foreground))]/85 hover:bg-[hsl(var(--muted))]"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0 opacity-90" />
              {t(labelKey)}
            </NavLink>
          ))}
          <>
            <button
              type="button"
              onClick={() => setSubscribersOpen((prev) => !prev)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isSubscribersRoute
                  ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                  : "text-[hsl(var(--foreground))]/85 hover:bg-[hsl(var(--muted))]"
              )}
            >
              <Wifi className="h-4 w-4 shrink-0 opacity-90" />
              <span className="flex-1 text-start">{t("nav.subscribersGroup")}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", subscribersOpen ? "rotate-180" : "rotate-0")} />
            </button>
            {subscribersOpen
              ? subscribersNav.map(({ to, labelKey, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        "ms-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                        isActive
                          ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                          : "text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-90" />
                    {t(labelKey)}
                  </NavLink>
                ))
              : null}
          </>
          {user?.role === "admin" ? (
            <>
              <button
                type="button"
                onClick={() => setStaffOpen((prev) => !prev)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isStaffRoute
                    ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                    : "text-[hsl(var(--foreground))]/85 hover:bg-[hsl(var(--muted))]"
                )}
              >
                <Shield className="h-4 w-4 shrink-0 opacity-90" />
                <span className="flex-1 text-start">{t("nav.staff")}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", staffOpen ? "rotate-180" : "rotate-0")} />
              </button>
              {staffOpen
                ? staffNav.map(({ to, labelKey, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === "/staff"}
                      className={({ isActive }) =>
                        cn(
                          "ms-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                          isActive
                            ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                            : "text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]"
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-90" />
                      {t(labelKey)}
                    </NavLink>
                  ))
                : null}
            </>
          ) : null}
          <>
            <button
              type="button"
              onClick={() => setInventoryOpen((prev) => !prev)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                isInventoryRoute
                  ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                  : "text-[hsl(var(--foreground))]/85 hover:bg-[hsl(var(--muted))]"
              )}
            >
              <FileText className="h-4 w-4 shrink-0 opacity-90" />
              <span className="flex-1 text-start">{t("nav.expensesGroup")}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", inventoryOpen ? "rotate-180" : "rotate-0")} />
            </button>
            {inventoryOpen
              ? inventoryNav.map(({ to, labelKey, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        "ms-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                        isActive
                          ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                          : "text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-90" />
                    {t(labelKey)}
                  </NavLink>
                ))
              : null}
          </>
          {canManageWhatsApp ? (
            <>
              <button
                type="button"
                onClick={() => setWhatsAppOpen((prev) => !prev)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isWhatsAppRoute
                    ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                    : "text-[hsl(var(--foreground))]/85 hover:bg-[hsl(var(--muted))]"
                )}
              >
                <MessageCircle className="h-4 w-4 shrink-0 opacity-90" />
                <span className="flex-1 text-start">{t("nav.whatsapp")}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", whatsAppOpen ? "rotate-180" : "rotate-0")} />
              </button>
              {whatsAppOpen
                ? whatsappNav.map(({ to, labelKey, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          "ms-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
                          isActive
                            ? "bg-[hsl(var(--primary))] text-white shadow-md shadow-[hsl(var(--primary))]/25"
                            : "text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]"
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-90" />
                      {t(labelKey)}
                    </NavLink>
                  ))
                : null}
            </>
          ) : null}
        </nav>
        <a
          href="/user/login"
          className="mx-2 mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[hsl(var(--foreground))]/80 hover:bg-[hsl(var(--muted))]"
        >
          <UserCircle className="h-4 w-4" />
          {t("nav.userPortal")}
        </a>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/80 px-6 py-4 backdrop-blur-sm">
          <div className="text-sm opacity-80">
            <span className="opacity-70">{t("header.signedIn")}</span>{" "}
            <span className="font-semibold text-[hsl(var(--foreground))]">{user?.name || user?.email}</span>
            <span className="mx-1 opacity-50">·</span>
            <span className="rounded-md bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-medium">{user?.role}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[hsl(var(--muted))]"
              title={t("nav.lang")}
            >
              <Languages className="h-4 w-4" />
              {t("nav.lang")}
            </button>
            <button
              type="button"
              onClick={toggle}
              className="rounded-xl p-2 hover:bg-[hsl(var(--muted))]"
              aria-label={t("header.theme")}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[hsl(var(--muted))]"
            >
              <LogOut className="h-4 w-4" />
              {t("header.logout")}
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
