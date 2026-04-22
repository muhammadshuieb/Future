import { Router } from "express";
import { promises as fs } from "fs";
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
import { requireAuth, requireRole } from "../middleware/auth.js";

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

export default router;
