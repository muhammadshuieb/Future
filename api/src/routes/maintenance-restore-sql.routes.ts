import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import multer from "multer";
import { config } from "../config.js";
import * as SqlRestore from "../services/sql-restore.service.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const RESTORE_ALLOWED_TABLES = [
  "nas",
  "radacct",
  "radcheck",
  "rm_allowedmanagers",
  "rm_allowednases",
  "rm_cards",
  "rm_changesrv",
  "rm_managers",
  "rm_services",
  "rm_usergroups",
  "rm_users",
] as const;

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

type RestoreSqlJob = {
  id: string;
  tenantId: string;
  staffId: string | null;
  status: "running" | "success" | "failed";
  progress_percent: number;
  stage: string;
  message: string | null;
  file_name: string;
  file_size_bytes: number;
  target_database: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  result: {
    bytes: number;
    restore_report: {
      executed_statements: number;
      ignored_statements: number;
      restored_users: number;
      restored_networks: number;
      restored_packages: number;
      restored_cards: number;
      restored_managers: number;
    };
  } | null;
};

const restoreSqlJobs = new Map<string, RestoreSqlJob>();
const restoreSqlRunningByTenant = new Map<string, string>();

function getRunningRestoreJobForTenant(tenantId: string): RestoreSqlJob | null {
  const id = restoreSqlRunningByTenant.get(tenantId);
  if (!id) return null;
  const job = restoreSqlJobs.get(id);
  if (!job) {
    restoreSqlRunningByTenant.delete(tenantId);
    return null;
  }
  if (job.status !== "running") {
    restoreSqlRunningByTenant.delete(tenantId);
    return null;
  }
  return job;
}

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
    const tenantId = req.auth!.tenantId;
    const running = getRunningRestoreJobForTenant(tenantId);
    if (running) {
      await fs.unlink(f.path).catch(() => undefined);
      res.status(409).json({
        error: "restore_sql_already_running",
        job: running,
      });
      return;
    }

    const applyExt =
      String(
        (req.body as { applySchemaExtensions?: string; apply_schema_extensions?: string })?.applySchemaExtensions ??
          (req.body as { apply_schema_extensions?: string })?.apply_schema_extensions ??
          ""
      ).toLowerCase() === "true";
    const id = randomUUID();
    const baseName = f.originalname || "upload.sql";
    const job: RestoreSqlJob = {
      id,
      tenantId,
      staffId: req.auth!.sub ?? null,
      status: "running",
      progress_percent: 1,
      stage: "queued",
      message: "queued",
      file_name: baseName,
      file_size_bytes: f.size,
      target_database: config.db.database,
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      result: null,
    };
    restoreSqlJobs.set(id, job);
    restoreSqlRunningByTenant.set(tenantId, id);
    res.status(202).json({
      ok: true,
      accepted: true,
      job_id: id,
      status: job,
    });

    void (async () => {
      try {
        const result = await SqlRestore.importSqlFilePathIntoAppDatabase(f.path, {
          applySchemaExtensions: applyExt,
          allowedTables: [...RESTORE_ALLOWED_TABLES],
          onProgress: (ev) => {
            const j = restoreSqlJobs.get(id);
            if (!j || j.status !== "running") return;
            j.progress_percent = Math.max(j.progress_percent, Math.min(99, Number(ev.percent || 0)));
            j.stage = ev.stage || j.stage;
            j.message = ev.message ?? j.message;
          },
        });
        if (!result.ok) {
          const err = result.error;
          job.status = "failed";
          job.progress_percent = 100;
          job.stage = "failed";
          job.message = "restore_failed";
          job.error = err.slice(0, 4000);
          job.finished_at = new Date().toISOString();
          try {
            await SqlRestore.recordSqlRestoreRun({
              tenantId,
              staffId: job.staffId,
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
          return;
        }
        job.status = "success";
        job.progress_percent = 100;
        job.stage = "done";
        job.message = "restore_completed";
        job.result = {
          bytes: result.detail.bytes,
          restore_report: result.detail.restore_report,
        };
        job.finished_at = new Date().toISOString();
        await SqlRestore.recordSqlRestoreRun({
          tenantId,
          staffId: job.staffId,
          fileName: baseName,
          fileSizeBytes: f.size,
          success: true,
          errorMessage: null,
          targetDatabase: config.db.database,
          applySchemaExtensions: applyExt,
          mysqlOutputExcerpt: null,
        }).catch((logErr) => {
          console.error("recordSqlRestoreRun failed", logErr);
        });
      } catch (e) {
        console.error("maintenance restore-sql", e);
        job.status = "failed";
        job.progress_percent = 100;
        job.stage = "failed";
        job.message = "restore_sql_internal";
        job.error = e instanceof Error ? e.message.slice(0, 4000) : String(e).slice(0, 4000);
        job.finished_at = new Date().toISOString();
      } finally {
        restoreSqlRunningByTenant.delete(tenantId);
        await fs.unlink(f.path).catch(() => undefined);
        setTimeout(() => {
          const current = restoreSqlJobs.get(id);
          if (current && current.status !== "running") {
            restoreSqlJobs.delete(id);
          }
        }, 30 * 60 * 1000);
      }
    })();
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

router.get("/restore-sql/progress/:jobId", async (req, res) => {
  if (req.auth?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const job = restoreSqlJobs.get(req.params.jobId);
  if (!job || job.tenantId !== req.auth!.tenantId) {
    res.status(404).json({ error: "restore_sql_job_not_found" });
    return;
  }
  res.json({ ok: true, job });
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
