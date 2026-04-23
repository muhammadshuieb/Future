import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { LocaleProvider } from "./context/LocaleContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AdminShell } from "./layouts/AdminShell";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { UsersPage } from "./pages/Users";
import { UserProfilePage } from "./pages/UserProfile";
import { PackagesPage } from "./pages/Packages";
import { BillingPage } from "./pages/Billing";
import { NasPage } from "./pages/Nas";
import { AccountingPage } from "./pages/Accounting";
import { ExpenseCategoriesPage } from "./pages/ExpenseCategories";
import { ExpensesPage } from "./pages/Expenses";
import { SettingsPage } from "./pages/Settings";
import { UserPortalLogin, UserPortalDashboard } from "./pages/UserPortal";
import { StaffUsersPage } from "./pages/StaffUsers";
import { RolesPermissionsPage } from "./pages/RolesPermissions";
import { AuditLogsPage } from "./pages/AuditLogs";
import { SubscriberZonesPage } from "./pages/SubscriberZones";
import { MaintenancePage } from "./pages/Maintenance";
import { WhatsAppConnectionPage } from "./pages/WhatsAppConnection";
import { WhatsAppTemplatesPage } from "./pages/WhatsAppTemplates";
import { WhatsAppBroadcastPage } from "./pages/WhatsAppBroadcast";
import { WhatsAppLogsPage } from "./pages/WhatsAppLogs";
import { OnlineUsersPage } from "./pages/OnlineUsers";
import { ObservabilityPage } from "./pages/Observability";
import { ServerLogsPage } from "./pages/ServerLogs";
import { SubscriberPublicPortalPage } from "./pages/SubscriberPublicPortal";
import { CardBatchPage } from "./pages/CardBatch";

function ProtectedAdmin({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/portal" element={<SubscriberPublicPortalPage />} />
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
        <Route path="users" element={<UsersPage />} />
        <Route path="subscriber-zones" element={<SubscriberZonesPage />} />
        <Route path="users/:id" element={<UserProfilePage />} />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="nas" element={<NasPage />} />
        <Route path="accounting" element={<AccountingPage />} />
        <Route path="observability" element={<ObservabilityPage />} />
        <Route path="server-logs" element={<ServerLogsPage />} />
        <Route path="online-users" element={<OnlineUsersPage />} />
        <Route path="inventory" element={<Navigate to="/inventory/expenses" replace />} />
        <Route path="inventory/categories" element={<ExpenseCategoriesPage />} />
        <Route path="inventory/cards" element={<CardBatchPage />} />
        <Route path="inventory/expenses" element={<ExpensesPage />} />
        <Route path="staff" element={<StaffUsersPage />} />
        <Route path="staff/roles-permissions" element={<RolesPermissionsPage />} />
        <Route path="staff/audit" element={<AuditLogsPage />} />
        <Route path="maintenance" element={<MaintenancePage />} />
        <Route path="whatsapp" element={<Navigate to="/whatsapp/connection" replace />} />
        <Route path="whatsapp/connection" element={<WhatsAppConnectionPage />} />
        <Route path="whatsapp/templates" element={<WhatsAppTemplatesPage />} />
        <Route path="whatsapp/broadcast" element={<WhatsAppBroadcastPage />} />
        <Route path="whatsapp/logs" element={<WhatsAppLogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
