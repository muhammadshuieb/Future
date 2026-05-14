import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { LocaleProvider, useI18n } from "./context/LocaleContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { FinancePeriodProvider } from "./context/FinancePeriodContext";
import { AdminShell } from "./layouts/AdminShell";
import { LoginPage } from "./pages/Login";
import { UserPortalLogin, UserPortalDashboard } from "./pages/UserPortal";
import { SubscriberPublicPortalPage } from "./pages/SubscriberPublicPortal";
import {
  PortalOutlet,
  PortalLoginPage,
  PortalDashboardPage,
  PortalUsagePage,
  PortalInvoicesPage,
  PortalPaymentsPage,
  PortalRenewPage,
  PortalPasswordPage,
  PortalSessionsPage,
  PortalDevicesPage,
  PortalSpeedTestPage,
  PortalSupportPage,
} from "./pages/portal/PortalPages";
import { QoeOverviewPage, RadiusMonitorOverviewPage, ResellersListPage } from "./pages/enterprise/EnterprisePages";

const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const UsersPage = lazy(() => import("./pages/Users").then((m) => ({ default: m.UsersPage })));
const UserProfilePage = lazy(() => import("./pages/UserProfile").then((m) => ({ default: m.UserProfilePage })));
const PackagesPage = lazy(() => import("./pages/Packages").then((m) => ({ default: m.PackagesPage })));
const BillingPage = lazy(() => import("./pages/Billing").then((m) => ({ default: m.BillingPage })));
const NasPage = lazy(() => import("./pages/Nas").then((m) => ({ default: m.NasPage })));
const AccountingPage = lazy(() => import("./pages/Accounting").then((m) => ({ default: m.AccountingPage })));
const ExpenseCategoriesPage = lazy(() =>
  import("./pages/ExpenseCategories").then((m) => ({ default: m.ExpenseCategoriesPage }))
);
const ExpensesPage = lazy(() => import("./pages/Expenses").then((m) => ({ default: m.ExpensesPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const StaffUsersPage = lazy(() => import("./pages/StaffUsers").then((m) => ({ default: m.StaffUsersPage })));
const RolesPermissionsPage = lazy(() =>
  import("./pages/RolesPermissions").then((m) => ({ default: m.RolesPermissionsPage }))
);
const AuditLogsPage = lazy(() => import("./pages/AuditLogs").then((m) => ({ default: m.AuditLogsPage })));
const SubscriberZonesPage = lazy(() =>
  import("./pages/SubscriberZones").then((m) => ({ default: m.SubscriberZonesPage }))
);
const MaintenancePage = lazy(() => import("./pages/Maintenance").then((m) => ({ default: m.MaintenancePage })));
const WhatsAppConnectionPage = lazy(() =>
  import("./pages/WhatsAppConnection").then((m) => ({ default: m.WhatsAppConnectionPage }))
);
const WhatsAppTemplatesPage = lazy(() =>
  import("./pages/WhatsAppTemplates").then((m) => ({ default: m.WhatsAppTemplatesPage }))
);
const WhatsAppBroadcastPage = lazy(() =>
  import("./pages/WhatsAppBroadcast").then((m) => ({ default: m.WhatsAppBroadcastPage }))
);
const WhatsAppLogsPage = lazy(() => import("./pages/WhatsAppLogs").then((m) => ({ default: m.WhatsAppLogsPage })));
const OnlineUsersPage = lazy(() => import("./pages/OnlineUsers").then((m) => ({ default: m.OnlineUsersPage })));
const ObservabilityPage = lazy(() =>
  import("./pages/Observability").then((m) => ({ default: m.ObservabilityPage }))
);
const SystemHealthPage = lazy(() =>
  import("./pages/SystemHealth").then((m) => ({ default: m.SystemHealthPage }))
);
const ServerLogsPage = lazy(() => import("./pages/ServerLogs").then((m) => ({ default: m.ServerLogsPage })));
const CardBatchPage = lazy(() =>
  import("./pages/PrepaidUnavailable").then((m) => ({ default: m.PrepaidUnavailablePage }))
);
const PrepaidCardsListPage = lazy(() =>
  import("./pages/PrepaidUnavailable").then((m) => ({ default: m.PrepaidUnavailablePage }))
);
const WireGuardPage = lazy(() => import("./pages/WireGuard").then((m) => ({ default: m.WireGuardPage })));
const FinanceDashboardPage = lazy(() =>
  import("./pages/FinanceDashboard").then((m) => ({ default: m.FinanceDashboardPage }))
);
const UpdatesPage = lazy(() => import("./pages/Updates").then((m) => ({ default: m.UpdatesPage })));
const EncodingHealthPage = lazy(() =>
  import("./pages/EncodingHealth").then((m) => ({ default: m.EncodingHealthPage }))
);
const SpeedProfilesPage = lazy(() =>
  import("./pages/SpeedProfilesPages").then((m) => ({ default: m.SpeedProfilesPage }))
);
const SpeedProfileSchedulesPage = lazy(() =>
  import("./pages/SpeedProfilesPages").then((m) => ({ default: m.SpeedProfileSchedulesPage }))
);
const SpeedProfilesLivePage = lazy(() =>
  import("./pages/SpeedProfilesPages").then((m) => ({ default: m.SpeedProfilesLivePage }))
);

function ProtectedAdmin({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[36vh] items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
      {t("common.loading")}
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/public-subscriber" element={<SubscriberPublicPortalPage />} />
        <Route path="/portal" element={<PortalOutlet />}>
          <Route index element={<Navigate to="/portal/dashboard" replace />} />
          <Route path="login" element={<PortalLoginPage />} />
          <Route path="dashboard" element={<PortalDashboardPage />} />
          <Route path="usage" element={<PortalUsagePage />} />
          <Route path="invoices" element={<PortalInvoicesPage />} />
          <Route path="payments" element={<PortalPaymentsPage />} />
          <Route path="renew" element={<PortalRenewPage />} />
          <Route path="password" element={<PortalPasswordPage />} />
          <Route path="sessions" element={<PortalSessionsPage />} />
          <Route path="devices" element={<PortalDevicesPage />} />
          <Route path="speed-test" element={<PortalSpeedTestPage />} />
          <Route path="support" element={<PortalSupportPage />} />
        </Route>
        <Route path="/user/login" element={<UserPortalLogin />} />
        <Route path="/user/dashboard" element={<UserPortalDashboard />} />
        <Route
          path="/"
          element={
            <ProtectedAdmin>
              <AdminShell />
            </ProtectedAdmin>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="finance-dashboard" element={<FinanceDashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/prepaid-cards" element={<CardBatchPage />} />
          <Route path="users/prepaid-cards-list" element={<PrepaidCardsListPage />} />
          <Route path="subscriber-zones" element={<SubscriberZonesPage />} />
          <Route path="users/:id" element={<UserProfilePage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="nas" element={<NasPage />} />
          <Route path="accounting" element={<AccountingPage />} />
          <Route path="observability" element={<ObservabilityPage />} />
          <Route path="system-health" element={<SystemHealthPage />} />
          <Route path="server-logs" element={<ServerLogsPage />} />
          <Route path="encoding-health" element={<EncodingHealthPage />} />
          <Route path="speed-profiles" element={<SpeedProfilesPage />} />
          <Route path="speed-profiles/schedules" element={<SpeedProfileSchedulesPage />} />
          <Route path="speed-profiles/live" element={<SpeedProfilesLivePage />} />
          <Route path="qoe/overview" element={<QoeOverviewPage />} />
          <Route path="radius-monitor/overview" element={<RadiusMonitorOverviewPage />} />
          <Route path="resellers" element={<ResellersListPage />} />
          <Route path="online-users" element={<OnlineUsersPage />} />
          <Route path="inventory" element={<Navigate to="/inventory/expenses" replace />} />
          <Route path="inventory/categories" element={<ExpenseCategoriesPage />} />
          <Route path="inventory/cards" element={<Navigate to="/packages" replace />} />
          <Route path="inventory/expenses" element={<ExpensesPage />} />
          <Route path="staff" element={<StaffUsersPage />} />
          <Route path="staff/roles-permissions" element={<RolesPermissionsPage />} />
          <Route path="staff/audit" element={<AuditLogsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
          <Route path="maintenance/updates" element={<UpdatesPage />} />
          <Route path="wireguard" element={<WireGuardPage />} />
          <Route path="whatsapp" element={<Navigate to="/whatsapp/connection" replace />} />
          <Route path="whatsapp/connection" element={<WhatsAppConnectionPage />} />
          <Route path="whatsapp/templates" element={<WhatsAppTemplatesPage />} />
          <Route path="whatsapp/broadcast" element={<WhatsAppBroadcastPage />} />
          <Route path="whatsapp/logs" element={<WhatsAppLogsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <FinancePeriodProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </FinancePeriodProvider>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
