import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import multer from "multer";
import { z } from "zod";
import {
  deleteBackupRun,
  getBackupFileForDownload,
  getRcloneStatus,
  listBackupRuns,
  runDatabaseBackup,
  testRcloneConnection,
  updateRcloneSettings,
} from "../services/backup.service.js";
import { config } from "../config.js";
import {
  getRestoreMaxBytes,
  importSqlFilePathIntoAppDatabase,
  resolveSchemaExtensionsPath,
} from "../services/sql-restore.service.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const uploadSql = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, tmpdir()),
    filename: (_req, _f, cb) => cb(null, `fr-upload-${Date.now()}-${process.pid}.sql`),
  }),
  limits: { fileSize: getRestoreMaxBytes(), files: 1 },
});
router.use(requireAuth);
router.use(requireRole("admin", "manager"));

router.get("/backups", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const items = await listBackupRuns(tenantId, 100);
    res.json({ items });
  } catch (e) {
    console.error("maintenance backups list", e);
    res.status(500).json({ error: "backup_list_failed" });
  }
});

router.delete("/backups/:id", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const result = await deleteBackupRun(tenantId, req.params.id);
    if (!result.deleted) {
      res.status(404).json({ error: "backup_not_found" });
      return;
    }
    res.json(result);
  } catch (e) {
    console.error("maintenance backups delete", e);
    res.status(500).json({ error: "backup_delete_failed" });
  }
});

const rcloneSettingsBody = z.object({
  enabled: z.boolean(),
  remoteName: z.string().max(64).optional().nullable(),
  remotePath: z.string().max(255).optional().nullable(),
  configText: z.string().min(2).optional().nullable(),
});

router.get("/rclone", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const status = await getRcloneStatus(tenantId);
    res.json({ status });
  } catch (e) {
    console.error("maintenance rclone status", e);
    res.status(500).json({ error: "rclone_status_failed" });
  }
});

router.post("/rclone/test", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const status = await testRcloneConnection(tenantId);
    res.json({ status });
  } catch (e) {
    console.error("maintenance rclone test", e);
    res.status(500).json({ error: "rclone_test_failed" });
  }
});

router.put("/rclone", async (req, res) => {
  const parsed = rcloneSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const tenantId = req.auth!.tenantId;
    const status = await updateRcloneSettings(tenantId, parsed.data);
    res.json({ status });
  } catch (e) {
    console.error("maintenance rclone save", e);
    res.status(500).json({ error: "rclone_save_failed" });
  }
});

router.post("/backups/run", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const createdByStaffId = req.auth!.sub;
    const item = await runDatabaseBackup({
      tenantId,
      triggeredBy: "manual",
      createdByStaffId,
    });
    res.json({ item });
  } catch (e) {
    console.error("maintenance backups run", e);
    res.status(500).json({ error: "backup_run_failed" });
  }
});

router.get("/backups/:id/download", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    const ref = await getBackupFileForDownload(tenantId, req.params.id);
    if (!ref) {
      res.status(404).json({ error: "backup_file_not_found" });
      return;
    }
    try {
      await fs.access(ref.filePath);
    } catch {
      res.status(404).json({ error: "backup_file_missing_on_disk" });
      return;
    }
    res.download(ref.filePath, ref.fileName);
  } catch (e) {
    console.error("maintenance backups download", e);
    res.status(500).json({ error: "backup_download_failed" });
  }
});

/**
 * استعادة ملف SQL (مثل radius.sql) ودمجه في قاعدة بيانات المشروع (DATABASE_URL).
 * يتطلب عميل `mysql` على الخادم أو داخل صورة Docker. للإدمن فقط.
 */
router.post(
  "/restore-sql",
  (req, res, next) => {
    if (req.auth?.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  },
  uploadSql.single("file"),
  async (req, res) => {
    const f = req.file;
    if (!f?.path) {
      res.status(400).json({ error: "missing_file", detail: "Send multipart field name: file" });
      return;
    }
    try {
      const raw = req.body?.applySchemaExtensions;
      const applySchemaExtensions =
        raw === true ||
        raw === "true" ||
        raw === "1" ||
        String(raw ?? "true").toLowerCase() === "true";
      const result = await importSqlFilePathIntoAppDatabase(f.path, { applySchemaExtensions });
      if (!result.ok) {
        const err = result.error;
        const code =
          err === "sql_too_large"
            ? 413
            : err === "schema_extensions_not_found"
              ? 503
              : err.startsWith("mysql_") || err.includes("ENOENT")
                ? 503
                : 400;
        res.status(code).json({
          error: "restore_sql_failed",
          detail: err.slice(0, 4000),
          schema_extensions_path: resolveSchemaExtensionsPath(),
        });
        return;
      }
      res.json({
        ok: true,
        bytes: result.detail.bytes,
        applied_schema_extensions: result.detail.appliedSchemaExtensions,
        database: config.databaseName,
      });
    } catch (e) {
      console.error("maintenance restore-sql", e);
      res.status(500).json({ error: "restore_sql_internal" });
    } finally {
      await fs.unlink(f.path).catch(() => undefined);
    }
  }
);

router.get("/restore-sql/info", (req, res) => {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({
    max_bytes: getRestoreMaxBytes(),
    schema_extensions_resolved: resolveSchemaExtensionsPath(),
  });
});

router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const m = err as { code?: string } | null;
  if (m?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file_too_large" });
    return;
  }
  next(err);
});

export default router;
