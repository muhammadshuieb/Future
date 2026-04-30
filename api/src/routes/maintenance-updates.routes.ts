import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireAuth, requireRole } from "../middleware/auth.js";

const execFileAsync = promisify(execFile);
const router = Router();

router.use(requireAuth);
router.use(requireRole("admin"));

function getUpdateConfig() {
  const branch = process.env.APP_UPDATE_BRANCH?.trim() || "main";
  const remote = process.env.APP_UPDATE_REMOTE?.trim() || "origin";
  const repoDir = process.env.APP_UPDATE_REPO_DIR?.trim() || process.cwd();
  const enabled = String(process.env.APP_UPDATE_ENABLED || "").toLowerCase() === "true";
  const token = process.env.APP_UPDATE_TOKEN?.trim() || "";
  const composeEnabled = String(process.env.APP_UPDATE_DOCKER_ENABLED || "true").toLowerCase() === "true";
  const composeDir = process.env.APP_UPDATE_COMPOSE_DIR?.trim() || repoDir;
  const composeFile = process.env.APP_UPDATE_COMPOSE_FILE?.trim() || "";
  const gitBin = process.env.APP_UPDATE_GIT_BIN?.trim() || "git";
  const composeBin = process.env.APP_UPDATE_COMPOSE_BIN?.trim() || "";
  const runtimeFile = process.env.APP_UPDATE_RUNTIME_FILE?.trim() || "/app/runtime/update-feature.json";
  const updateStateFile = process.env.APP_UPDATE_STATE_FILE?.trim() || "/app/runtime/update-state.json";
  const autoIntervalMinutes = Math.max(0, Number.parseInt(process.env.APP_UPDATE_AUTO_INTERVAL_MINUTES ?? "30", 10) || 30);
  const requireToken = String(process.env.APP_UPDATE_REQUIRE_TOKEN || "false").toLowerCase() === "true";
  const composeRemoveOrphans = String(process.env.APP_UPDATE_COMPOSE_REMOVE_ORPHANS ?? "true").toLowerCase() !== "false";
  const composeRetryRecycleOnPortConflict =
    String(process.env.APP_UPDATE_COMPOSE_RETRY_RECYCLE_ON_PORT_CONFLICT ?? "true").toLowerCase() !== "false";
  const composeRecycleServices = (process.env.APP_UPDATE_COMPOSE_RECYCLE_SERVICES ?? "mysql,waha")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s));
  return {
    branch,
    remote,
    repoDir,
    enabled,
    token,
    composeEnabled,
    composeDir,
    composeFile,
    gitBin,
    composeBin,
    runtimeFile,
    updateStateFile,
    autoIntervalMinutes,
    requireToken,
    composeRemoveOrphans,
    composeRetryRecycleOnPortConflict,
    composeRecycleServices,
  };
}

async function runGit(gitBin: string, args: string[], cwd: string) {
  const { stdout } = await execFileAsync(gitBin, args, {
    cwd,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function runCommand(cmd: string, args: string[], cwd: string) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() };
  } catch (unknownErr: unknown) {
    const e = unknownErr as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    const out = e.stdout != null ? String(e.stdout).trim() : "";
    const errOut = e.stderr != null ? String(e.stderr).trim() : "";
    const parts = [e.message || String(e), errOut, out].filter(Boolean);
    throw new Error(parts.join("\n"));
  }
}

async function commandExists(cmd: string, args: string[], cwd: string): Promise<boolean> {
  try {
    await runCommand(cmd, args, cwd);
    return true;
  } catch {
    return false;
  }
}

async function resolveComposeCommand(cfg: ReturnType<typeof getUpdateConfig>): Promise<{ cmd: string; baseArgs: string[] }> {
  if (cfg.composeBin) {
    if (cfg.composeBin === "docker-compose") return { cmd: "docker-compose", baseArgs: [] };
    if (cfg.composeBin === "docker") return { cmd: "docker", baseArgs: ["compose"] };
  }
  if (await commandExists("docker", ["compose", "version"], cfg.composeDir)) {
    return { cmd: "docker", baseArgs: ["compose"] };
  }
  if (await commandExists("docker-compose", ["version"], cfg.composeDir)) {
    return { cmd: "docker-compose", baseArgs: [] };
  }
  throw new Error("compose_binary_not_found");
}

async function readRuntimeEnabled(runtimeFile: string): Promise<boolean | null> {
  try {
    const raw = await readFile(runtimeFile, "utf8");
    const json = JSON.parse(raw) as { enabled?: unknown };
    return typeof json.enabled === "boolean" ? json.enabled : null;
  } catch {
    return null;
  }
}

async function writeRuntimeEnabled(runtimeFile: string, enabled: boolean): Promise<void> {
  const dir = path.dirname(runtimeFile);
  await mkdir(dir, { recursive: true });
  await writeFile(runtimeFile, JSON.stringify({ enabled }, null, 2), "utf8");
}

type UpdateRunState = {
  lastCheckedAt?: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string | null;
  beforeCommit?: string | null;
  afterCommit?: string | null;
  currentCommitDate?: string | null;
  remoteCommit?: string | null;
  remoteCommitDate?: string | null;
};

async function readUpdateState(file: string): Promise<UpdateRunState> {
  try {
    const raw = await readFile(file, "utf8");
    const json = JSON.parse(raw) as UpdateRunState;
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

async function writeUpdateState(file: string, patch: UpdateRunState): Promise<void> {
  const current = await readUpdateState(file);
  const next = { ...current, ...patch };
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2), "utf8");
}

/** Host ports mentioned in Docker "Bind for … failed" messages (for UI hints). */
function extractDockerBindPorts(log: string): string[] {
  const found = new Set<string>();
  for (const line of log.split(/\r?\n/)) {
    const m = line.match(/Bind for .*:(\d+)\s+failed/i);
    if (m?.[1]) found.add(m[1]);
  }
  return [...found];
}

function isDockerPortBindConflict(message: string): boolean {
  const low = message.toLowerCase();
  return (
    low.includes("port is already allocated") ||
    low.includes("address already in use") ||
    (low.includes("bind for") && low.includes("failed"))
  );
}

function portConflictHints(ports: string[]): string[] {
  const list = ports.length ? ports.join(", ") : "3306, 3001, …";
  return [
    `تعارض منافذ على المضيف (${list}). غالباً حاوية أخرى أو نسخة ثانية من نفس المشروع، أو MySQL مثبت على النظام يستخدم 3306.`,
    `Host port conflict (${list}). Another container, a second stack, or host mysqld may already bind these ports.`,
    `التحديث يعيد المحاولة تلقائياً مرة بعد إيقاف وإزالة حاويات mysql وwaha (volumes تبقى). إن استمر الخطأ فالمنافذ محجوزة من خدمة أخرى: APP_UPDATE_COMPOSE_RETRY_RECYCLE_ON_PORT_CONFLICT=false لتعطيل ذلك.`,
    `Updates retry once after compose stop+rm for mysql,waha (data volumes kept). If it still fails, another process holds the ports. Set APP_UPDATE_COMPOSE_RETRY_RECYCLE_ON_PORT_CONFLICT=false to disable.`,
    `على الخادم: docker ps --format "table {{.Names}}\\t{{.Ports}}" ثم أوقف الحاوية التي تعرض 3306 أو 3001 (docker stop <name>).`,
    `On the host: docker ps --format "table {{.Names}}\\t{{.Ports}}" and docker stop the container publishing the conflicting port.`,
  ];
}

function composeFileArgs(cfg: ReturnType<typeof getUpdateConfig>): string[] {
  return cfg.composeFile ? ["-f", cfg.composeFile] : [];
}

/** Stop and remove named compose services (containers only; named volumes unchanged). */
async function runComposeRecycle(
  compose: { cmd: string; baseArgs: string[] },
  cfg: ReturnType<typeof getUpdateConfig>,
  services: string[]
): Promise<void> {
  if (services.length === 0) return;
  const base = [...compose.baseArgs, ...composeFileArgs(cfg)];
  await runCommand(compose.cmd, [...base, "stop", ...services], cfg.composeDir);
  await runCommand(compose.cmd, [...base, "rm", "-f", ...services], cfg.composeDir);
}

async function resolveCommitDate(gitBin: string, cwd: string, commit: string): Promise<string | null> {
  if (!commit) return null;
  try {
    const out = await runGit(gitBin, ["show", "-s", "--format=%cI", commit], cwd);
    return out || null;
  } catch {
    return null;
  }
}

async function runUpdateProcess(cfg: ReturnType<typeof getUpdateConfig>) {
  const steps: string[] = [];
  steps.push("git fetch");
  await runGit(cfg.gitBin, ["fetch", cfg.remote, cfg.branch], cfg.repoDir);
  steps.push("git checkout");
  await runGit(cfg.gitBin, ["checkout", cfg.branch], cfg.repoDir);
  const before = await runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir);
  steps.push("git pull --ff-only");
  await runGit(cfg.gitBin, ["pull", "--ff-only", cfg.remote, cfg.branch], cfg.repoDir);
  const after = await runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir);

  let composeStatus: string | undefined;
  if (cfg.composeEnabled) {
    const compose = await resolveComposeCommand(cfg);
    const upTail = ["up", "-d", "--build", ...(cfg.composeRemoveOrphans ? (["--remove-orphans"] as const) : [])];
    const composeUpArgs = [...compose.baseArgs, ...composeFileArgs(cfg), ...upTail];
    steps.push(`docker compose ${upTail.join(" ")}`);
    try {
      await runCommand(compose.cmd, composeUpArgs, cfg.composeDir);
    } catch (firstUpErr) {
      const msg = firstUpErr instanceof Error ? firstUpErr.message : String(firstUpErr);
      if (
        cfg.composeRetryRecycleOnPortConflict &&
        isDockerPortBindConflict(msg) &&
        cfg.composeRecycleServices.length > 0
      ) {
        steps.push(`compose recycle ${cfg.composeRecycleServices.join(",")} (port conflict) + retry up`);
        await runComposeRecycle(compose, cfg, cfg.composeRecycleServices);
        await runCommand(compose.cmd, composeUpArgs, cfg.composeDir);
      } else {
        throw firstUpErr;
      }
    }
    const psArgs = [...compose.baseArgs, ...composeFileArgs(cfg), "ps"];
    steps.push("docker compose ps");
    const ps = await runCommand(compose.cmd, psArgs, cfg.composeDir);
    composeStatus = ps.stdout;
  }

  const [currentCommitDate, remoteCommit, remoteCommitDate] = await Promise.all([
    resolveCommitDate(cfg.gitBin, cfg.repoDir, after),
    runGit(cfg.gitBin, ["ls-remote", cfg.remote, `refs/heads/${cfg.branch}`], cfg.repoDir).then((raw) =>
      (raw.split(/\s+/)[0] || "").trim()
    ),
    runGit(cfg.gitBin, ["show", "-s", "--format=%cI", `${cfg.remote}/${cfg.branch}`], cfg.repoDir).catch(() => ""),
  ]);

  await writeUpdateState(cfg.updateStateFile, {
    lastRunAt: new Date().toISOString(),
    lastStatus: "ok",
    lastError: null,
    beforeCommit: before,
    afterCommit: after,
    currentCommitDate,
    remoteCommit: remoteCommit || null,
    remoteCommitDate: remoteCommitDate || null,
  });

  return {
    changed: before !== after,
    beforeCommit: before,
    afterCommit: after,
    composeEnabled: cfg.composeEnabled,
    composeStatus,
    steps,
    currentCommitDate,
    remoteCommit: remoteCommit || null,
    remoteCommitDate: remoteCommitDate || null,
  };
}

router.get("/updates/status", async (_req, res) => {
  const cfg = getUpdateConfig();
  try {
    const runtimeEnabled = await readRuntimeEnabled(cfg.runtimeFile);
    const effectiveEnabled = runtimeEnabled ?? cfg.enabled;
    const [currentCommit, currentBranch] = await Promise.all([
      runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
      runGit(cfg.gitBin, ["rev-parse", "--abbrev-ref", "HEAD"], cfg.repoDir),
    ]);
    const [currentCommitDate, state] = await Promise.all([
      resolveCommitDate(cfg.gitBin, cfg.repoDir, currentCommit),
      readUpdateState(cfg.updateStateFile),
    ]);
    res.json({
      ok: true,
      updateEnabled: effectiveEnabled,
      envUpdateEnabled: cfg.enabled,
      runtimeUpdateEnabled: runtimeEnabled,
      repoDir: cfg.repoDir,
      configuredRemote: cfg.remote,
      configuredBranch: cfg.branch,
      currentBranch,
      currentCommit,
      currentCommitDate,
      lastCheckedAt: state.lastCheckedAt ?? null,
      lastRunAt: state.lastRunAt ?? null,
      lastStatus: state.lastStatus ?? null,
      remoteCommit: state.remoteCommit ?? null,
      remoteCommitDate: state.remoteCommitDate ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "status_failed";
    res.status(500).json({ error: "update_status_failed", detail: message });
  }
});

router.get("/updates/feature", async (_req, res) => {
  const cfg = getUpdateConfig();
  const runtimeEnabled = await readRuntimeEnabled(cfg.runtimeFile);
  res.json({
    ok: true,
    envEnabled: cfg.enabled,
    runtimeEnabled,
    effectiveEnabled: runtimeEnabled ?? cfg.enabled,
  });
});

router.put("/updates/feature", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const cfg = getUpdateConfig();
  try {
    await writeRuntimeEnabled(cfg.runtimeFile, enabled);
    res.json({ ok: true, runtimeEnabled: enabled, effectiveEnabled: enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "feature_toggle_failed";
    res.status(500).json({ error: "feature_toggle_failed", detail: message });
  }
});

router.post("/updates/check", async (_req, res) => {
  const cfg = getUpdateConfig();
  try {
    const [localCommit, remoteCommit] = await Promise.all([
      runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
      runGit(cfg.gitBin, ["ls-remote", cfg.remote, `refs/heads/${cfg.branch}`], cfg.repoDir).then((raw) =>
        (raw.split(/\s+/)[0] || "").trim()
      ),
    ]);
    const updateAvailable = Boolean(remoteCommit) && localCommit !== remoteCommit;
    const remoteCommitDate = await runGit(cfg.gitBin, ["show", "-s", "--format=%cI", `${cfg.remote}/${cfg.branch}`], cfg.repoDir).catch(() => "");
    await writeUpdateState(cfg.updateStateFile, {
      lastCheckedAt: new Date().toISOString(),
      remoteCommit: remoteCommit || null,
      remoteCommitDate: remoteCommitDate || null,
      lastError: null,
    });
    res.json({
      ok: true,
      updateAvailable,
      localCommit,
      remoteCommit,
      remoteCommitDate: remoteCommitDate || null,
      remote: cfg.remote,
      branch: cfg.branch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "check_failed";
    res.status(500).json({ error: "update_check_failed", detail: message });
  }
});

router.post("/updates/run", async (req, res) => {
  const cfg = getUpdateConfig();
  const runtimeEnabled = await readRuntimeEnabled(cfg.runtimeFile);
  const effectiveEnabled = runtimeEnabled ?? cfg.enabled;
  if (!effectiveEnabled) {
    res.status(403).json({ error: "update_disabled" });
    return;
  }
  const headerToken = String(req.headers["x-update-token"] || "").trim();
  if (cfg.requireToken && (!cfg.token || headerToken !== cfg.token)) {
    res.status(401).json({ error: "invalid_update_token" });
    return;
  }
  try {
    const result = await runUpdateProcess(cfg);
    res.json({
      ok: true,
      ...result,
      note: cfg.composeEnabled ? undefined : "Docker auto-rebuild disabled by APP_UPDATE_DOCKER_ENABLED=false.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "run_failed";
    if (/spawn .* ENOENT/i.test(message) || message.includes("compose_binary_not_found")) {
      res.status(500).json({
        error: "update_runtime_binary_missing",
        detail:
          "Missing runtime binary. Set APP_UPDATE_GIT_BIN and/or APP_UPDATE_COMPOSE_BIN to valid commands/paths in API environment.",
      });
      return;
    }
    if (isDockerPortBindConflict(message)) {
      const ports = extractDockerBindPorts(message);
      await writeUpdateState(cfg.updateStateFile, {
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: message,
      }).catch(() => {});
      res.status(500).json({
        error: "update_port_conflict",
        detail: message,
        ports: ports.length ? ports : null,
        hints: portConflictHints(ports),
      });
      return;
    }
    await writeUpdateState(cfg.updateStateFile, {
      lastRunAt: new Date().toISOString(),
      lastStatus: "error",
      lastError: message,
    }).catch(() => {});
    res.status(500).json({ error: "update_run_failed", detail: message });
  }
});

let autoUpdateStarted = false;
export function startAutoUpdateLoop(): void {
  if (autoUpdateStarted) return;
  autoUpdateStarted = true;
  const cfg = getUpdateConfig();
  if (cfg.autoIntervalMinutes <= 0) return;
  const tick = async () => {
    try {
      const runtimeEnabled = await readRuntimeEnabled(cfg.runtimeFile);
      const effectiveEnabled = runtimeEnabled ?? cfg.enabled;
      if (!effectiveEnabled) return;
      const localCommit = await runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir);
      const remoteCommit = await runGit(cfg.gitBin, ["ls-remote", cfg.remote, `refs/heads/${cfg.branch}`], cfg.repoDir).then((raw) =>
        (raw.split(/\s+/)[0] || "").trim()
      );
      await writeUpdateState(cfg.updateStateFile, {
        lastCheckedAt: new Date().toISOString(),
        remoteCommit: remoteCommit || null,
      });
      if (!remoteCommit || remoteCommit === localCommit) return;
      await runUpdateProcess(cfg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeUpdateState(cfg.updateStateFile, {
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: message,
      }).catch(() => {});
      console.error("[updates:auto] failed", message);
    }
  };
  void tick();
  const intervalMs = cfg.autoIntervalMinutes * 60_000;
  setInterval(() => {
    void tick();
  }, intervalMs);
}

export default router;
