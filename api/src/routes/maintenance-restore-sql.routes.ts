import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import multer from "multer";
import { config } from "../config.js";
import * as SqlRestore from "../services/sql-restore.service.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const uploadSql = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, tmpdir()),
    filename: (_req, _f, cb) => cb(null, `fr-upload-${Date.now()}-${process.pid}.sql`),
  }),
  limits: { fileSize: SqlRestore.getRestoreMaxBytes(), files: 1 },
});

router.use(requireAuth);
router.use(requireRole("admin", "manager"));

/**
 * مُسجّل في ملف مُستقل + ربط مباشر في index حتى تُتاح المسارات بثبات
 * (POST/GET على restore-sql) دون الاعتماد فقط على maintenance.routes.
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
      const applyExt =
        String(
          (req.body as { applySchemaExtensions?: string; apply_schema_extensions?: string })?.applySchemaExtensions ??
            (req.body as { apply_schema_extensions?: string })?.apply_schema_extensions ??
            ""
        ).toLowerCase() === "true";
      const result = await SqlRestore.importSqlFilePathIntoAppDatabase(f.path, {
        applySchemaExtensions: applyExt,
      });
      const tenantId = req.auth!.tenantId;
      const staffId = req.auth!.sub ?? null;
      const baseName = f.originalname || "upload.sql";
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
        try {
          await SqlRestore.recordSqlRestoreRun({
            tenantId,
            staffId,
            fileName: baseName,
            fileSizeBytes: f.size,
            success: false,
            errorMessage: err.slice(0, 2000),
            targetDatabase: config.db.database,
            applySchemaExtensions: applyExt,
            mysqlOutputExcerpt: result.mysql_output?.slice(0, 4000) ?? null,
          });
        } catch (logErr) {
          console.error("recordSqlRestoreRun failed", logErr);
        }
        res.status(code).json({
          ok: false,
          error: "restore_sql_failed",
          detail: err.slice(0, 4000),
          mysql_output: result.mysql_output?.slice(0, 8000) ?? null,
          target_database: config.db.database,
          schema_extensions_path: SqlRestore.resolveSchemaExtensionsPath(),
        });
        return;
      }
      const restoredAt = new Date().toISOString();
      try {
        await SqlRestore.recordSqlRestoreRun({
          tenantId,
          staffId,
          fileName: baseName,
          fileSizeBytes: f.size,
          success: true,
          errorMessage: null,
          targetDatabase: config.db.database,
          applySchemaExtensions: applyExt,
          mysqlOutputExcerpt: null,
        });
      } catch (logErr) {
        console.error("recordSqlRestoreRun failed", logErr);
      }
      res.json({
        ok: true,
        restored_at: restoredAt,
        bytes: result.detail.bytes,
        database: config.databaseName,
        target_database: config.db.database,
      });
    } catch (e) {
      console.error("maintenance restore-sql", e);
      res.status(500).json({ error: "restore_sql_internal" });
    } finally {
      await fs.unlink(f.path).catch(() => undefined);
    }
  }
);

router.get("/restore-sql/info", async (req, res) => {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const data = await SqlRestore.getSqlRestoreInfoForApi(req.auth!.tenantId);
    res.json(data);
  } catch (e) {
    console.error("restore-sql/info", e);
    res.status(500).json({ error: "restore_info_failed" });
  }
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
