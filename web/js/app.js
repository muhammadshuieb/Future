import {
  api,
  getApiBase,
  setApiBase,
  getToken,
  setToken,
  setUser,
  getUser,
  clearSession,
} from "./api.js";

/** @param {string} s */
function esc(s) {
  if (s == null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {bigint | number | string} n */
function formatBytes(n) {
  const v = typeof n === "bigint" ? Number(n) : Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

/** عرض حصة الباقة بالجيجابايت (0 = غير محدود). */
function formatQuotaGb(bytes) {
  const raw = String(bytes ?? "0").trim();
  if (!raw || raw === "0") return "غير محدود";
  try {
    const b = BigInt(raw);
    if (b <= 0n) return "غير محدود";
    const gb = Number(b) / 1024 ** 3;
    if (!Number.isFinite(gb)) return "—";
    return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
  } catch {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "غير محدود";
    const gb = n / 1024 ** 3;
    return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
  }
}

/** إدخال المستخدم بالـ GB → سلسلة بايت للـ API. */
function quotaGbInputToBytesString(gbStr) {
  const n = parseFloat(String(gbStr).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.round(n * 1024 ** 3));
}

/** @param {unknown} d */
function fmtDate(d) {
  if (d == null) return "—";
  try {
    return new Date(String(d)).toLocaleString("ar", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return esc(String(d));
  }
}

function canManage() {
  const r = getUser()?.role;
  return r === "admin" || r === "manager";
}

/**
 * Inline page dialog instead of browser popups.
 * @param {{ title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
function showInlineConfirm(options) {
  const {
    title,
    message,
    confirmText = "تأكيد",
    cancelText = "إلغاء",
    danger = false,
  } = options;
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-backdrop";
    root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2>
        <div style="margin:10px 0 14px;border:1px solid ${danger ? "rgba(239,68,68,.45)" : "rgba(245,158,11,.45)"};background:${danger ? "rgba(127,29,29,.28)" : "rgba(120,53,15,.24)"};border-radius:12px;padding:10px 12px;">
          <strong style="display:block;margin-bottom:4px;">⚠️ ${esc(title)}</strong>
          <div>${esc(message)}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${esc(confirmText)}</button>
        </div>
      </div>`;
    const close = (result) => {
      root.remove();
      resolve(result);
    };
    root.querySelector("[data-cancel]")?.addEventListener("click", () => close(false));
    root.querySelector("[data-confirm]")?.addEventListener("click", () => close(true));
    root.addEventListener("click", (ev) => {
      if (ev.target === root) close(false);
    });
    document.body.appendChild(root);
  });
}

const views = {
  dashboard: renderDashboard,
  subscribers: renderSubscribers,
  packages: renderPackages,
  invoices: renderInvoices,
  payments: renderPayments,
  nas: renderNas,
  accounting: renderAccounting,
};

function getRoute() {
  const h = (location.hash || "#/dashboard").replace(/^#\/?/, "");
  const name = h.split("/")[0] || "dashboard";
  return views[name] ? name : "dashboard";
}

function navigate() {
  if (!getToken()) {
    location.hash = "#/login";
    render();
    return;
  }
  const route = getRoute();
  if (route === "login") {
    location.hash = "#/dashboard";
    render();
    return;
  }
  render();
}

async function render() {
  const root = document.getElementById("root");
  if (!root) return;

  if (!getToken()) {
    root.innerHTML = loginTemplate();
    bindLogin();
    return;
  }

  const route = getRoute();
  const title =
    {
      dashboard: "لوحة التحكم",
      subscribers: "المشتركين",
      packages: "الباقات",
      invoices: "الفواتير",
      payments: "المدفوعات",
      nas: "أجهزة NAS",
      accounting: "المحاسبة والاستخدام",
    }[route] || "لوحة التحكم";

  root.innerHTML = shellTemplate(title, route);
  bindShell();

  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = `<p class="lead">جاري التحميل…</p>`;
  try {
    await views[route](main);
  } catch (e) {
    const msg =
      e && typeof e === "object" && "data" in e && e.data && typeof e.data === "object"
        ? JSON.stringify(e.data)
        : String(e);
    main.innerHTML = `<div class="flash flash-error">فشل التحميل: ${esc(msg)}</div>`;
  }
}

function loginTemplate() {
  const base = esc(getApiBase());
  return `
    <div class="app-login">
      <div class="login-card">
        <div class="brand">
          <div class="brand-mark">FR</div>
          <h1>Future Radius</h1>
          <p class="subtitle">إدارة اشتراكات RADIUS وبيانات DMA من مكان واحد</p>
        </div>
        <form id="login-form">
          <label for="api-base">عنوان الـ API</label>
          <input id="api-base" type="url" value="${base}" autocomplete="off" />
          <label for="email">البريد الإلكتروني</label>
          <input id="email" type="email" value="admin@local.test" required />
          <label for="password">كلمة المرور</label>
          <input id="password" type="password" required autocomplete="current-password" />
          <button type="submit" class="btn btn-primary">تسجيل الدخول</button>
        </form>
        <p class="subtitle" style="margin-top:1.5rem;text-align:center;font-size:0.8rem;">
          للتجربة المحلية: <code class="mono">docker compose exec api node dist/scripts/seed-staff.js</code>
        </p>
      </div>
    </div>`;
}

function bindLogin() {
  const form = document.getElementById("login-form");
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = /** @type {HTMLInputElement} */ (document.getElementById("email")).value;
    const password = /** @type {HTMLInputElement} */ (document.getElementById("password"))
      .value;
    const base = /** @type {HTMLInputElement} */ (document.getElementById("api-base")).value;
    setApiBase(base.trim());
    try {
      /** @type {{ token: string; user: { id: string; email: string; role: string; tenantId: string } }} */
      const data = await api("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setToken(data.token);
      setUser(data.user);
      location.hash = "#/dashboard";
      navigate();
    } catch (e) {
      const el = document.querySelector(".login-card");
      const flash = document.createElement("div");
      flash.className = "flash flash-error";
      flash.textContent = "بيانات الدخول غير صحيحة أو تعذر الاتصال بالخادم.";
      el?.insertBefore(flash, el.firstChild?.nextSibling || null);
    }
  });
}

/**
 * @param {string} title
 * @param {string} route
 */
function shellTemplate(title, route) {
  const u = getUser();
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" style="width:44px;height:44px;font-size:1rem;">FR</div>
          <h1>Future Radius</h1>
          <p class="subtitle">لوحة الإدارة</p>
        </div>
        <button type="button" class="nav-item ${route === "dashboard" ? "active" : ""}" data-go="dashboard">
          <span class="nav-icon">⌂</span> لوحة التحكم
        </button>
        <button type="button" class="nav-item ${route === "subscribers" ? "active" : ""}" data-go="subscribers">
          <span class="nav-icon">👥</span> المشتركين
        </button>
        <button type="button" class="nav-item ${route === "packages" ? "active" : ""}" data-go="packages">
          <span class="nav-icon">📦</span> الباقات
        </button>
        <button type="button" class="nav-item ${route === "invoices" ? "active" : ""}" data-go="invoices">
          <span class="nav-icon">🧾</span> الفواتير
        </button>
        <button type="button" class="nav-item ${route === "payments" ? "active" : ""}" data-go="payments">
          <span class="nav-icon">💳</span> المدفوعات
        </button>
        <button type="button" class="nav-item ${route === "nas" ? "active" : ""}" data-go="nas">
          <span class="nav-icon">🛰</span> NAS
        </button>
        <button type="button" class="nav-item ${route === "accounting" ? "active" : ""}" data-go="accounting">
          <span class="nav-icon">📶</span> الاستخدام
        </button>
        <div class="sidebar-footer">
          <div>${esc(u?.email || "")}</div>
          <div class="mono" style="margin-top:0.35rem;">${esc(u?.role || "")}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="logout" style="margin-top:0.75rem;width:100%;">خروج</button>
        </div>
      </aside>
      <div class="main">
        <header>
          <h1 id="page-title">${esc(title)}</h1>
          <p class="lead">واجهة عربية متصلة بـ API — Future Radius</p>
        </header>
        <div id="main"></div>
      </div>
    </div>`;
}

function bindShell() {
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const go = btn.getAttribute("data-go");
      if (go) location.hash = `#/${go}`;
    });
  });
  document.getElementById("logout")?.addEventListener("click", () => {
    clearSession();
    location.hash = "#/login";
    render();
  });
}

/** @param {HTMLElement} el */
async function renderDashboard(el) {
  let summary = { active_sessions: 0, tracked_bytes_total: 0 };
  try {
    summary = await api("/api/accounting/summary");
  } catch {
    /* radacct قد يكون غير موجود في بيئة التطوير */
  }
  let subs = [];
  try {
    const r = await api("/api/subscribers");
    subs = r.items || [];
  } catch {
    /* */
  }
  let pkgs = [];
  try {
    const r = await api("/api/packages");
    pkgs = r.items || [];
  } catch {
    /* */
  }

  el.innerHTML = `
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">جلسات نشطة (تقديري)</div>
        <div class="stat-value">${esc(String(summary.active_sessions ?? 0))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">الاستخدام المجمّع (متابعة حية)</div>
        <div class="stat-value">${formatBytes(summary.tracked_bytes_total ?? 0)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">عدد المشتركين</div>
        <div class="stat-value">${subs.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">الباقات</div>
        <div class="stat-value">${pkgs.length}</div>
      </div>
    </div>
    <div class="flash flash-info">
      استخدم القائمة للتنقل. تأكد من استيراد قاعدة DMA كاملة إن أردت أرقام محاسبة دقيقة من <span class="mono">radacct</span>.
    </div>`;
}

let _packagesCache = [];

/** @param {HTMLElement} el */
async function renderSubscribers(el) {
  const data = await api("/api/subscribers");
  const items = data.items || [];
  _packagesCache = (await api("/api/packages")).items || [];

  const addBtn =
    canManage()
      ? `<button type="button" class="btn btn-primary btn-sm" id="open-sub-modal">مشترك جديد</button>`
      : "";

  el.innerHTML = `
    <div class="toolbar">${addBtn}</div>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>اسم المستخدم</th>
            <th>الحالة</th>
            <th>الباقة</th>
            <th>انتهاء الاشتراك</th>
            ${canManage() ? "<th></th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${items
            .map((s) => {
              const dis =
                canManage() && (s.status === "active" || !s.status)
                  ? `<button type="button" class="btn btn-danger btn-sm" data-disable="${esc(s.id)}">تعطيل</button>`
                  : canManage()
                    ? `<span class="badge badge-muted">${esc(s.status)}</span>`
                    : "";
              return `<tr>
              <td class="mono">${esc(s.username)}</td>
              <td><span class="badge ${s.status === "active" ? "badge-success" : "badge-muted"}">${esc(s.status || "—")}</span></td>
              <td>${esc(s.package_name || "—")}</td>
              <td>${fmtDate(s.expiration_date)}</td>
              ${canManage() ? `<td>${dis}</td>` : ""}
            </tr>`;
            })
            .join("") || `<tr><td colspan="5"><div class="empty-state">لا يوجد مشتركون بعد</div></td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="sub-modal-root"></div>`;

  if (canManage()) {
    document.getElementById("open-sub-modal")?.addEventListener("click", () =>
      openSubscriberModal(el),
    );
    el.querySelectorAll("[data-disable]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-disable");
        if (!id) return;
        const confirmed = await showInlineConfirm({
          title: "تعطيل مشترك",
          message: "تأكيد تعطيل هذا المشترك؟",
          confirmText: "تعطيل",
          danger: true,
        });
        if (!confirmed) return;
        await api(`/api/subscribers/${encodeURIComponent(id)}/disable`, { method: "PATCH" });
        await renderSubscribers(el);
      });
    });
  }
}

/** @param {HTMLElement} parent */
function openSubscriberModal(parent) {
  const root = parent.querySelector("#sub-modal-root");
  if (!root) return;
  if (!_packagesCache.length) {
    void showInlineConfirm({
      title: "تنبيه",
      message: "أنشئ باقة أولاً من صفحة الباقات.",
      confirmText: "حسناً",
      cancelText: "إغلاق",
    });
    return;
  }
  const opts = _packagesCache
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join("");
  root.innerHTML = `
    <div class="modal-backdrop" id="sub-backdrop">
      <div class="modal" role="dialog">
        <h2>إضافة مشترك</h2>
        <form id="sub-form">
          <label>اسم المستخدم</label>
          <input name="username" required minlength="1" />
          <label>كلمة المرور</label>
          <input name="password" type="password" required />
          <label>الباقة</label>
          <select name="package_id" required>${opts}</select>
          <label>ملاحظات (اختياري)</label>
          <textarea name="notes" rows="2"></textarea>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" id="sub-cancel">إلغاء</button>
            <button type="submit" class="btn btn-primary">حفظ</button>
          </div>
        </form>
      </div>
    </div>`;
  const backdrop = document.getElementById("sub-backdrop");
  document.getElementById("sub-cancel")?.addEventListener("click", () => {
    root.innerHTML = "";
  });
  backdrop?.addEventListener("click", (ev) => {
    if (ev.target === backdrop) root.innerHTML = "";
  });
  document.getElementById("sub-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(/** @type {HTMLFormElement} */ (ev.target));
    try {
      await api("/api/subscribers", {
        method: "POST",
        body: {
          username: String(fd.get("username") || ""),
          password: String(fd.get("password") || ""),
          package_id: String(fd.get("package_id") || ""),
          notes: fd.get("notes") ? String(fd.get("notes")) : undefined,
        },
      });
      root.innerHTML = "";
      const main = document.getElementById("main");
      if (main) await renderSubscribers(main);
    } catch {
      void showInlineConfirm({
        title: "فشل العملية",
        message: "تعذر الإنشاء — تحقق من الصلاحيات أو البيانات.",
        confirmText: "موافق",
        cancelText: "إغلاق",
        danger: true,
      });
    }
  });
}

/** @param {HTMLElement} el */
async function renderPackages(el) {
  const data = await api("/api/packages");
  const items = data.items || [];
  const addBtn = canManage()
    ? `<button type="button" class="btn btn-primary btn-sm" id="open-pkg-modal">باقة جديدة</button>`
    : "";

  el.innerHTML = `
    <div class="toolbar">${addBtn}</div>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>الاسم</th>
            <th>السعر</th>
            <th>فترة الفوترة (يوم)</th>
            <th>الحصة (GB)</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (p) => `<tr>
            <td><strong>${esc(p.name)}</strong></td>
            <td>${esc(String(p.price))} ${esc(p.currency || "")}</td>
            <td>${esc(String(p.billing_period_days ?? "—"))}</td>
            <td class="mono">${formatQuotaGb(p.quota_total_bytes || 0)}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="4"><div class="empty-state">لا توجد باقات</div></td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="pkg-modal-root"></div>`;

  document.getElementById("open-pkg-modal")?.addEventListener("click", () => {
    const root = el.querySelector("#pkg-modal-root");
    if (!root) return;
    root.innerHTML = `
      <div class="modal-backdrop" id="pkg-backdrop">
        <div class="modal">
          <h2>باقة جديدة</h2>
          <form id="pkg-form">
            <label>الاسم</label>
            <input name="name" required />
            <label>السعر</label>
            <input name="price" type="number" step="0.01" value="0" />
            <label>العملة</label>
            <input name="currency" value="USD" />
            <label>أيام الفوترة</label>
            <input name="billing_period_days" type="number" value="30" min="1" />
            <label>الحصة بالجيجابايت (0 = غير محدود)</label>
            <input name="quota_gb" type="number" step="0.01" min="0" value="0" />
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" id="pkg-cancel">إلغاء</button>
              <button type="submit" class="btn btn-primary">إنشاء</button>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById("pkg-cancel")?.addEventListener("click", () => {
      root.innerHTML = "";
    });
    document.getElementById("pkg-backdrop")?.addEventListener("click", (ev) => {
      if (ev.target === ev.currentTarget) root.innerHTML = "";
    });
    document.getElementById("pkg-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(/** @type {HTMLFormElement} */ (ev.target));
      try {
        await api("/api/packages", {
          method: "POST",
          body: {
            name: String(fd.get("name") || ""),
            price: Number(fd.get("price") || 0),
            currency: String(fd.get("currency") || "USD"),
            billing_period_days: Number(fd.get("billing_period_days") || 30),
            quota_total_bytes: quotaGbInputToBytesString(String(fd.get("quota_gb") ?? "0")),
          },
        });
        root.innerHTML = "";
        const main = document.getElementById("main");
        if (main) await renderPackages(main);
      } catch {
        void showInlineConfirm({
          title: "فشل الإنشاء",
          message: "تعذر إنشاء الباقة.",
          confirmText: "موافق",
          cancelText: "إغلاق",
          danger: true,
        });
      }
    });
  });
}

/** @param {HTMLElement} el */
async function renderInvoices(el) {
  const data = await api("/api/invoices");
  const items = data.items || [];
  el.innerHTML = `
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>المبلغ</th>
            <th>الحالة</th>
            <th>الإصدار</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (i) => `<tr>
            <td class="mono">${esc(i.invoice_no)}</td>
            <td>${esc(String(i.amount))} ${esc(i.currency || "")}</td>
            <td><span class="badge badge-${i.status === "paid" ? "success" : "warn"}">${esc(i.status)}</span></td>
            <td>${fmtDate(i.issue_date)}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="4"><div class="empty-state">لا توجد فواتير</div></td></tr>`}
        </tbody>
      </table>
    </div>`;
}

/** @param {HTMLElement} el */
async function renderPayments(el) {
  const data = await api("/api/payments");
  const items = data.items || [];
  el.innerHTML = `
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>المبلغ</th>
            <th>طريقة الدفع</th>
            <th>فاتورة</th>
            <th>التاريخ</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (p) => `<tr>
            <td>${esc(String(p.amount))} ${esc(p.currency || "")}</td>
            <td>${esc(p.method || "—")}</td>
            <td class="mono">${esc(p.invoice_no || "—")}</td>
            <td>${fmtDate(p.paid_at)}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="4"><div class="empty-state">لا توجد مدفوعات</div></td></tr>`}
        </tbody>
      </table>
    </div>`;
}

/** @param {HTMLElement} el */
async function renderNas(el) {
  const data = await api("/api/nas");
  const modern = data.nas_servers || [];
  const legacy = data.nas_legacy || [];
  const addBtn = canManage()
    ? `<button type="button" class="btn btn-primary btn-sm" id="open-nas-modal">NAS جديد (مشفّر)</button>`
    : "";

  el.innerHTML = `
    <div class="toolbar">${addBtn}</div>
    <h3 class="section-title">خوادم NAS (Future Radius)</h3>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>الاسم</th>
            <th>IP</th>
            <th>النوع</th>
            <th>الحالة</th>
            <th>CoA</th>
          </tr>
        </thead>
        <tbody>
          ${modern
            .map(
              (n) => `<tr>
            <td>${esc(n.name)}</td>
            <td class="mono">${esc(n.ip)}</td>
            <td>${esc(n.type || "—")}</td>
            <td><span class="badge badge-success">${esc(n.status)}</span></td>
            <td>${esc(String(n.coa_port ?? "—"))}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="5"><div class="empty-state">لا توجد سجلات حديثة</div></td></tr>`}
        </tbody>
      </table>
    </div>
    <h3 class="section-title">NAS التقليدي (جدول <span class="mono">nas</span>)</h3>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>الاسم</th>
            <th>IP</th>
            <th>النوع</th>
          </tr>
        </thead>
        <tbody>
          ${legacy
            .map(
              (n) => `<tr>
            <td>${esc(n.name)}</td>
            <td class="mono">${esc(n.ip)}</td>
            <td>${esc(n.type || "—")}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="3"><div class="empty-state">الجدول غير مستورد أو فارغ</div></td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="nas-modal-root"></div>`;

  document.getElementById("open-nas-modal")?.addEventListener("click", () => {
    const root = el.querySelector("#nas-modal-root");
    if (!root) return;
    root.innerHTML = `
      <div class="modal-backdrop" id="nas-bd">
        <div class="modal">
          <h2>إضافة NAS</h2>
          <form id="nas-form">
            <label>الاسم المعروض</label>
            <input name="name" required />
            <label>عنوان IP</label>
            <input name="ip" required />
            <label>سر RADIUS (يُخزّن مشفّراً)</label>
            <input name="secret" type="password" required />
            <label>النوع (اختياري)</label>
            <input name="type" placeholder="mikrotik" />
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" id="nas-cancel">إلغاء</button>
              <button type="submit" class="btn btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById("nas-cancel")?.addEventListener("click", () => {
      root.innerHTML = "";
    });
    document.getElementById("nas-bd")?.addEventListener("click", (ev) => {
      if (ev.target === ev.currentTarget) root.innerHTML = "";
    });
    document.getElementById("nas-form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(/** @type {HTMLFormElement} */ (ev.target));
      try {
        await api("/api/nas", {
          method: "POST",
          body: {
            name: String(fd.get("name") || ""),
            ip: String(fd.get("ip") || ""),
            secret: String(fd.get("secret") || ""),
            type: fd.get("type") ? String(fd.get("type")) : undefined,
          },
        });
        root.innerHTML = "";
        const main = document.getElementById("main");
        if (main) await renderNas(main);
      } catch {
        void showInlineConfirm({
          title: "فشل الحفظ",
          message: "تعذر حفظ NAS.",
          confirmText: "موافق",
          cancelText: "إغلاق",
          danger: true,
        });
      }
    });
  });
}

/** @param {HTMLElement} el */
async function renderAccounting(el) {
  let summary = { active_sessions: 0, tracked_bytes_total: 0 };
  try {
    summary = await api("/api/accounting/summary");
  } catch (e) {
    /* */
  }
  let sessions = [];
  let count = 0;
  try {
    const s = await api("/api/accounting/sessions");
    sessions = s.sessions || [];
    count = s.count ?? 0;
  } catch {
    /* radacct قد يكون غائباً */
  }

  el.innerHTML = `
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">جلسات فعّالة</div>
        <div class="stat-value">${esc(String(summary.active_sessions ?? count))}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">إجمالي الاستخدام (متابعة حية)</div>
        <div class="stat-value">${formatBytes(summary.tracked_bytes_total ?? 0)}</div>
      </div>
    </div>
    <h3 class="section-title">جلسات حديثة (عند توفر <span class="mono">radacct</span>)</h3>
    <div class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>المستخدم</th>
            <th>NAS IP</th>
            <th>وقت البدء</th>
            <th>مدة</th>
          </tr>
        </thead>
        <tbody>
          ${(sessions || [])
            .slice(0, 80)
            .map(
              (r) => `<tr>
            <td class="mono">${esc(r.username)}</td>
            <td class="mono">${esc(r.nasipaddress)}</td>
            <td>${fmtDate(r.acctstarttime)}</td>
            <td>${esc(String(r.acctsessiontime ?? "—"))}</td>
          </tr>`,
            )
            .join("") || `<tr><td colspan="4"><div class="empty-state">لا توجد جلسات أو الجدول غير موجود</div></td></tr>`}
        </tbody>
      </table>
    </div>`;
}

window.addEventListener("hashchange", navigate);

getToken() ? navigate() : render();
