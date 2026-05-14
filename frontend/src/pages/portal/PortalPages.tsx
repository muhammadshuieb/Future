import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../../context/LocaleContext";
import { portalApiFetch, setPortalToken, getPortalToken } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { TextField } from "../../components/ui/TextField";

function usePortalAuth() {
  return Boolean(getPortalToken());
}

export function PortalLoginPage() {
  const { t, isRtl } = useI18n();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await portalApiFetch("/api/portal/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(String((j as { error?: string }).error ?? "login_failed"));
      return;
    }
    const data = (await r.json()) as { token: string };
    setPortalToken(data.token);
    nav("/portal/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900/30 to-[hsl(var(--background))] px-4 py-10" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mx-auto max-w-md">
        <Card className="p-6">
          <h1 className="mb-1 text-xl font-bold">{t("portal.loginTitle")}</h1>
          <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">{t("portal.loginSubtitle")}</p>
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <TextField label={t("userPortalLogin.user")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <TextField
              label={t("userPortalLogin.pass")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {err ? <p className="text-sm text-red-500">{err}</p> : null}
            <Button type="submit" className="w-full">
              {t("userPortalLogin.submit")}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function PortalChrome({ children }: { children: React.ReactNode }) {
  const { t, isRtl } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  if (!usePortalAuth() && loc.pathname !== "/portal/login") {
    return <Navigate to="/portal/login" replace />;
  }
  const links = [
    { to: "/portal/dashboard", label: t("portal.navDashboard") },
    { to: "/portal/usage", label: t("portal.navUsage") },
    { to: "/portal/invoices", label: t("portal.navInvoices") },
    { to: "/portal/payments", label: t("portal.navPayments") },
    { to: "/portal/renew", label: t("portal.navRenew") },
    { to: "/portal/password", label: t("portal.navPassword") },
    { to: "/portal/sessions", label: t("portal.navSessions") },
    { to: "/portal/devices", label: t("portal.navDevices") },
    { to: "/portal/speed-test", label: t("portal.navSpeed") },
    { to: "/portal/support", label: t("portal.navSupport") },
  ];
  return (
    <div className="min-h-screen bg-[hsl(var(--background))]" dir={isRtl ? "rtl" : "ltr"}>
      <header className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg flex-wrap items-center gap-2 px-3 py-2">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`rounded-lg px-2 py-1 text-xs font-medium ${loc.pathname === l.to ? "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300" : "text-[hsl(var(--muted-foreground))]"}`}
            >
              {l.label}
            </Link>
          ))}
          <Button
            type="button"
            variant="outline"
            className="ms-auto text-xs"
            onClick={() => {
              setPortalToken(null);
              nav("/portal/login");
            }}
          >
            {t("header.logout")}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-3 py-4">{children}</main>
    </div>
  );
}

export function PortalDashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/dashboard");
      if (r.ok) setData(await r.json());
    })();
  }, []);
  return (
    <PortalChrome>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t("portal.dashboardTitle")}</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </PortalChrome>
  );
}

export function PortalUsagePage() {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/usage");
      if (r.ok) setData(await r.json());
    })();
  }, []);
  return (
    <PortalChrome>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t("portal.usageTitle")}</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </PortalChrome>
  );
}

export function PortalInvoicesPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<unknown[]>([]);
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/invoices");
      if (r.ok) {
        const j = (await r.json()) as { items: unknown[] };
        setItems(j.items ?? []);
      }
    })();
  }, []);
  return (
    <PortalChrome>
      <Card className="space-y-2 p-4">
        <h2 className="font-semibold">{t("portal.invoicesTitle")}</h2>
        <ul className="space-y-2 text-sm">
          {items.map((row) => {
            const inv = row as { id: string; invoice_no: string; status: string; amount: string };
            return (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))]/60 pb-2">
                <span>
                  {inv.invoice_no} — {inv.status}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs"
                  onClick={async () => {
                    const r = await portalApiFetch(`/api/portal/invoices/${inv.id}/pdf`);
                    if (!r.ok) return;
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    window.open(url, "_blank", "noopener");
                  }}
                >
                  PDF
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </PortalChrome>
  );
}

export function PortalPaymentsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<{ items: unknown[]; methods: unknown[] } | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [currency, setCurrency] = useState("USD");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/payment-requests");
      if (r.ok) setData((await r.json()) as { items: unknown[]; methods: unknown[] });
    })();
  }, []);
  async function createReq() {
    setMsg("");
    const r = await portalApiFetch("/api/portal/payment-requests", {
      method: "POST",
      body: JSON.stringify({ amount: Number(amount), currency, method }),
    });
    setMsg(r.ok ? t("portal.paymentCreated") : await r.text());
    if (r.ok) {
      const j = await portalApiFetch("/api/portal/payment-requests");
      if (j.ok) setData((await j.json()) as { items: unknown[]; methods: unknown[] });
    }
  }
  return (
    <PortalChrome>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("portal.paymentsTitle")}</h2>
        <TextField label={t("portal.amount")} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextField label={t("portal.currency")} value={currency} onChange={(e) => setCurrency(e.target.value)} />
        <TextField label={t("portal.method")} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Button type="button" onClick={() => void createReq()}>
          {t("portal.createPaymentRequest")}
        </Button>
        {msg ? <p className="text-sm">{msg}</p> : null}
        <pre className="text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </PortalChrome>
  );
}

export function PortalRenewPage() {
  const { t } = useI18n();
  const [packageId, setPackageId] = useState("");
  const [res, setRes] = useState("");
  async function renew() {
    const r = await portalApiFetch("/api/portal/renew", {
      method: "POST",
      body: JSON.stringify({ package_id: packageId.trim() || null }),
    });
    setRes(r.ok ? JSON.stringify(await r.json()) : await r.text());
  }
  return (
    <PortalChrome>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("portal.renewTitle")}</h2>
        <TextField label={t("portal.optionalPackageId")} value={packageId} onChange={(e) => setPackageId(e.target.value)} />
        <Button type="button" onClick={() => void renew()}>
          {t("portal.renewSubmit")}
        </Button>
        {res ? <pre className="text-xs">{res}</pre> : null}
      </Card>
    </PortalChrome>
  );
}

export function PortalPasswordPage() {
  const { t } = useI18n();
  const [pw, setPw] = useState("");
  const [sync, setSync] = useState(false);
  const [msg, setMsg] = useState("");
  async function save() {
    const r = await portalApiFetch("/api/portal/password", {
      method: "POST",
      body: JSON.stringify({ new_password: pw, sync_radius: sync }),
    });
    setMsg(r.ok ? t("portal.passwordUpdated") : await r.text());
  }
  return (
    <PortalChrome>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("portal.passwordTitle")}</h2>
        <TextField type="password" label={t("portal.newPassword")} value={pw} onChange={(e) => setPw(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          {t("portal.syncRadius")}
        </label>
        <Button type="button" onClick={() => void save()}>
          {t("common.save")}
        </Button>
        {msg ? <p className="text-sm">{msg}</p> : null}
      </Card>
    </PortalChrome>
  );
}

export function PortalSessionsPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"active" | "closed">("active");
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch(`/api/portal/sessions?mode=${mode}`);
      if (r.ok) setData(await r.json());
    })();
  }, [mode]);
  return (
    <PortalChrome>
      <Card className="space-y-2 p-4">
        <div className="flex gap-2">
          <Button type="button" variant={mode === "active" ? "primary" : "outline"} onClick={() => setMode("active")}>
            {t("portal.sessionsActive")}
          </Button>
          <Button type="button" variant={mode === "closed" ? "primary" : "outline"} onClick={() => setMode("closed")}>
            {t("portal.sessionsClosed")}
          </Button>
        </div>
        <pre className="text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </PortalChrome>
  );
}

export function PortalDevicesPage() {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/devices");
      if (r.ok) setData(await r.json());
    })();
  }, []);
  return (
    <PortalChrome>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t("portal.devicesTitle")}</h2>
        <pre className="text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
      </Card>
    </PortalChrome>
  );
}

export function PortalSpeedTestPage() {
  const { t } = useI18n();
  const [msg, setMsg] = useState("");
  async function run() {
    const t0 = performance.now();
    await fetch(`${import.meta.env.BASE_URL}`.replace(/\/?$/, "/") || "/", { cache: "no-store" }).catch(() => null);
    const latency = Math.round(performance.now() - t0);
    const r = await portalApiFetch("/api/portal/speed-test", {
      method: "POST",
      body: JSON.stringify({ latency_ms: latency, client_meta: { userAgent: navigator.userAgent } }),
    });
    setMsg(r.ok ? t("portal.speedSaved") : await r.text());
  }
  return (
    <PortalChrome>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("portal.speedTitle")}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t("portal.speedHint")}</p>
        <Button type="button" onClick={() => void run()}>
          {t("portal.speedRun")}
        </Button>
        {msg ? <p className="text-sm">{msg}</p> : null}
      </Card>
    </PortalChrome>
  );
}

export function PortalSupportPage() {
  const { t } = useI18n();
  const [data, setData] = useState<unknown>(null);
  const [waMsg, setWaMsg] = useState("");
  useEffect(() => {
    void (async () => {
      const r = await portalApiFetch("/api/portal/support");
      if (r.ok) setData(await r.json());
    })();
  }, []);
  async function sendWa() {
    const r = await portalApiFetch("/api/portal/whatsapp/statement", { method: "POST", body: "{}" });
    setWaMsg(r.ok ? t("portal.whatsappSent") : await r.text());
  }
  const phone = data && typeof data === "object" ? String((data as { accountant_phone?: string }).accountant_phone ?? "") : "";
  const wa = `https://wa.me/${phone.replace(/\D/g, "")}`;
  return (
    <PortalChrome>
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("portal.supportTitle")}</h2>
        <pre className="text-xs">{data ? JSON.stringify(data, null, 2) : t("common.loading")}</pre>
        {phone ? (
          <a className="inline-flex rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white" href={wa} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : null}
        <Button type="button" variant="outline" onClick={() => void sendWa()}>
          {t("portal.whatsappStatement")}
        </Button>
        {waMsg ? <p className="text-sm">{waMsg}</p> : null}
      </Card>
    </PortalChrome>
  );
}

export function PortalOutlet() {
  return (
    <>
      <PortalPwaRegister />
      <Outlet />
    </>
  );
}

export function PortalPwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}portal-sw.js`).catch(() => {});
    }
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      const l = document.createElement("link");
      l.rel = "manifest";
      l.href = `${import.meta.env.BASE_URL}portal-manifest.json`;
      document.head.appendChild(l);
    }
  }, []);
  return null;
}
