import { Router } from "express";
import { promises as fs } from "fs";
import { z } from "zod";
import {
  applyGoogleDrivePasteToken,
  deleteBackupRunsBulk,
  deleteBackupRun,
  disconnectGoogleDriveBackup,
  getBackupFileForDownload,
  getGoogleDriveAuthUrl,
  getRcloneStatus,
  isGoogleDriveOAuthConfigured,
  listBackupRuns,
  runDatabaseBackup,
  testRcloneConnection,
  updateBackupSchedule,
  updateRcloneSettings,
} from "../services/backup.service.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { inferApiPublicOrigin, inferReturnFrontendOrigin } from "../lib/public-origin.js";

const router = Router();
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

const deleteManyBackupsBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(300),
});

router.post("/backups/delete-many", async (req, res) => {
  const parsed = deleteManyBackupsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const tenantId = req.auth!.tenantId;
    const result = await deleteBackupRunsBulk(tenantId, parsed.data.ids);
    res.json(result);
  } catch (e) {
    console.error("maintenance backups delete many", e);
    res.status(500).json({ error: "backup_delete_many_failed" });
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

router.get("/rclone/google/authorize-url", async (req, res) => {
  try {
    if (!isGoogleDriveOAuthConfigured()) {
      res.status(503).json({ error: "google_oauth_not_configured" });
      return;
    }
    const tenantId = req.auth!.tenantId;
    const apiPublicOrigin = inferApiPublicOrigin(req);
    const returnFrontendOrigin = inferReturnFrontendOrigin(req, apiPublicOrigin);
    const url = getGoogleDriveAuthUrl(tenantId, { apiPublicOrigin, returnFrontendOrigin });
    res.json({ url });
  } catch (e) {
    console.error("maintenance rclone google url", e);
    res.status(500).json({ error: "google_oauth_url_failed" });
  }
});

const pasteGoogleTokenBody = z.object({
  tokenJson: z.string().min(10).max(32_000),
});

router.post("/rclone/google/paste-token", async (req, res) => {
  const parsed = pasteGoogleTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const tenantId = req.auth!.tenantId;
    const status = await applyGoogleDrivePasteToken(tenantId, parsed.data.tokenJson);
    res.json({ status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "invalid_token_json") {
      res.status(400).json({ error: "invalid_token_json" });
      return;
    }
    console.error("maintenance rclone paste token", e);
    res.status(500).json({ error: "paste_token_failed" });
  }
});

router.delete("/rclone/google", async (req, res) => {
  try {
    const tenantId = req.auth!.tenantId;
    await disconnectGoogleDriveBackup(tenantId);
    const status = await getRcloneStatus(tenantId);
    res.json({ status });
  } catch (e) {
    console.error("maintenance rclone google disconnect", e);
    res.status(500).json({ error: "google_disconnect_failed" });
  }
});

const backupScheduleBody = z.object({
  enabled: z.boolean(),
  mode: z.enum(["daily", "twice_daily"]),
  time1: z.string().regex(/^\d{1,2}:\d{2}$/),
  time2: z.string().regex(/^\d{1,2}:\d{2}$/).optional().nullable(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

router.put("/backup-schedule", async (req, res) => {
  const parsed = backupScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  try {
    const tenantId = req.auth!.tenantId;
    await updateBackupSchedule(tenantId, {
      enabled: parsed.data.enabled,
      mode: parsed.data.mode,
      time1: parsed.data.time1,
      time2: parsed.data.time2 ?? null,
      retentionDays: parsed.data.retentionDays,
    });
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "backup_schedule_times_too_close") {
      res.status(400).json({ error: "backup_schedule_times_too_close" });
      return;
    }
    console.error("maintenance backup schedule", e);
    res.status(500).json({ error: "backup_schedule_save_failed" });
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

export default router;
