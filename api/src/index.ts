import http from "http";
import express from "express";
import { installLogger, log, markDbReady } from "./services/logger.service.js";

installLogger({ source: "api" });

import cors from "cors";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket as WsClient } from "ws";
import { Redis } from "ioredis";
import { config } from "./config.js";
import type { JwtPayload } from "./middleware/auth.js";
import authRoutes from "./routes/auth.routes.js";
import subscribersRoutes from "./routes/subscribers.js";
import { waitForDbReady } from "./lib/db.js";
import packagesRoutes from "./routes/packages.routes.js";
import invoicesRoutes from "./routes/invoices.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import nasRoutes from "./routes/nas.routes.js";
import accountingRoutes from "./routes/accounting.routes.js";
import subscriberPortalRoutes from "./routes/subscriber-portal.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import inventoryRoutes from "./routes/inventory.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import adminBackupRoutes from "./routes/admin-backup.routes.js";
import staffRoutes from "./routes/staff.routes.js";
import maintenanceRoutes from "./routes/maintenance.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import onlineUsersRoutes from "./routes/online-users.routes.js";
import auditRoutes from "./routes/audit.routes.js";
import observabilityRoutes from "./routes/observability.routes.js";
import serverLogsRoutes from "./routes/server-logs.routes.js";
import systemSettingsRoutes from "./routes/system-settings.routes.js";
import pptpRoutes from "./routes/pptp.routes.js";
import regionsRoutes from "./routes/regions.routes.js";
import { ensureDefaultAdminUser } from "./services/bootstrap-admin.service.js";
import { applyAllMigrations } from "./services/migrations.service.js";
import { ensureRadiusDbUser } from "./services/radius-db-user.service.js";
import { normalizeWhatsAppSettingsFromEnv } from "./services/whatsapp.service.js";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Future Radius API",
    health: "/health",
    base: "/api",
    websocket: "/ws?token=JWT",
    userPortal: "/api/user",
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/subscribers", subscribersRoutes);
app.use("/api/packages", packagesRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/nas", nasRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/user", subscriberPortalRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/admin", adminBackupRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/online-users", onlineUsersRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/observability", observabilityRoutes);
app.use("/api/server-logs", serverLogsRoutes);
app.use("/api/system-settings", systemSettingsRoutes);
app.use("/api/pptp", pptpRoutes);
app.use("/api/regions", regionsRoutes);

// Express error handler: captures unhandled async errors from any route.
// Must be declared AFTER all routes.
app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err instanceof Error ? err : new Error(String(err));
    log.error(`http_error ${req.method} ${req.originalUrl}: ${e.message}`, {
      method: req.method,
      url: req.originalUrl,
      status: 500,
    }, "http");
    if (!res.headersSent) {
      res.status(500).json({ error: "internal_error" });
    }
  }
);

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  try {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "", `http://${host}`);
    const token = url.searchParams.get("token");
    if (!token) {
      ws.close(4001, "missing token");
      return;
    }
    jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    ws.close(4002, "unauthorized");
    return;
  }
  ws.send(JSON.stringify({ type: "connected", channel: config.eventsChannel }));
});

const subRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
subRedis.subscribe(config.eventsChannel, (err?: Error | null) => {
  if (err) console.error("redis subscribe", err);
});
subRedis.on("message", (_channel: string, message: string) => {
  for (const client of wss.clients) {
    if (client.readyState === WsClient.OPEN) {
      client.send(message);
    }
  }
});

async function start() {
  await waitForDbReady();
  try {
    const report = await applyAllMigrations();
    console.log(
      `[bootstrap] migrations ran=${report.ran} failed=${report.failed} skipped=${report.skipped} benign=${report.benign}`
    );
  } catch (error) {
    console.error("[bootstrap] migrations failed", error);
  }
  // From this point `server_logs` should exist — flush anything buffered.
  markDbReady();
  log.info("api boot: migrations applied, flushing buffered logs", {}, "bootstrap");
  try {
    const result = await ensureRadiusDbUser();
    console.log(`[bootstrap] radius db user: ${result.status}`);
  } catch (error) {
    console.error("[bootstrap] radius db user failed", error);
  }
  try {
    await normalizeWhatsAppSettingsFromEnv();
  } catch (error) {
    console.error("[bootstrap] whatsapp normalize failed", error);
  }
  try {
    const seeded = await ensureDefaultAdminUser({ overwritePassword: false });
    console.log(`[bootstrap] default admin ${seeded.status}: ${seeded.email}`);
  } catch (error) {
    console.error("[bootstrap] default admin seed failed", error);
  }
  const host = process.env.LISTEN_HOST ?? "0.0.0.0";
  server.listen(config.port, host, () => {
    console.log(`API + WS listening on ${host}:${config.port}`);
  });
}

start().catch((e) => {
  console.error("API failed to start", e);
  process.exit(1);
});
