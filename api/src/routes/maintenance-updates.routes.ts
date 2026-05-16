import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { EventEmitter } from "node:events";

const execFileAsync = promisify(execFile);
const router = Router();

// Global event emitter for update progress streaming
const updateProgressEmitter = new EventEmitter();

// Update lock to prevent concurrent updates
let updateInProgress = false;
let lastUpdateError: { timestamp: string; message: string } | null = null;
let lastSuccessfulCommit: string | null = null;

// Circuit breaker for update service
const updateCircuitBreaker = {
  state: "closed" as "closed" | "open",
  failures: 0,
  maxFailures: 3,
  resetTimeout: 5 * 60 * 1000, // 5 minutes
  lastFailureTime: 0,
  
  canExecute(): boolean {
    if (this.state === "closed") return true;
    // Allow retry after timeout
    if (Date.now() - this.lastFailureTime > this.resetTimeout) {
      this.state = "closed";
      this.failures = 0;
      return true;
    }
    return false;
  },
  
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures) {
      this.state = "open";
    }
  },
  
  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  },
};

/** Timeout wrapper for async operations */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) in operation: ${operationName}`));
    }, timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

router.use(requireAuth);
router.use(requireRole("manager"));

/** Emit update progress event */
function emitProgress(type: "step" | "output" | "error" | "complete", data: any) {
  updateProgressEmitter.emit("progress", { type, data, timestamp: new Date().toISOString() });
}

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
  const composeProjectName = process.env.APP_UPDATE_COMPOSE_PROJECT_NAME?.trim() || "";
  const composeRecycleMaxPasses = Math.min(
    5,
    Math.max(1, Number.parseInt(process.env.APP_UPDATE_COMPOSE_RECYCLE_MAX_PASSES ?? "2", 10) || 2)
  );
  const composeKillBeforeRecycle =
    String(process.env.APP_UPDATE_COMPOSE_KILL_BEFORE_RECYCLE ?? "false").toLowerCase() === "true";
  const composeUpServicesRaw = process.env.APP_UPDATE_COMPOSE_UP_SERVICES?.trim();
  /** Empty = rebuild entire stack; "*" = same; default limits rebuild to app containers (skips mysql/freeradius). */
  const composeUpServices =
    composeUpServicesRaw === "*" || composeUpServicesRaw === ""
      ? []
      : (composeUpServicesRaw ?? "api,worker,web")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s));
  const composeBuildTimeoutMs = Math.min(
    30 * 60_000,
    Math.max(60_000, Number.parseInt(process.env.APP_UPDATE_COMPOSE_BUILD_TIMEOUT_MS ?? "900000", 10) || 900_000)
  );
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
    composeProjectName,
    composeRecycleMaxPasses,
    composeKillBeforeRecycle,
    composeUpServices,
    composeBuildTimeoutMs,
  };
}

async function runGit(gitBin: string, args: string[], cwd: string) {
  try {
    const { stdout } = await withTimeout(
      execFileAsync(gitBin, args, {
        cwd,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      }),
      70_000, // 70s timeout (includes buffer)
      `git ${args.slice(0, 2).join(" ")}`
    );
    return String(stdout || "").trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitProgress("error", `Git operation failed: ${msg}`);
    throw e;
  }
}

async function runCommand(cmd: string, args: string[], cwd: string, emitOutput: boolean = false) {
  try {
    const { stdout, stderr } = await withTimeout(
      execFileAsync(cmd, args, {
        cwd,
        windowsHide: true,
        timeout: 10 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
      11 * 60_000, // 11min timeout (includes buffer)
      `${cmd} ${args[0]}`
    );
    const out = String(stdout || "").trim();
    const errOut = String(stderr || "").trim();
    if (emitOutput) {
      if (out) emitProgress("output", out);
      if (errOut) emitProgress("output", errOut);
    }
    return { stdout: out, stderr: errOut };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    const parts = [err.message, err.stderr, err.stdout].filter((x) => typeof x === "string" && x.trim());
    const msg = parts.join("\n").trim() || String(e);
    if (emitOutput) emitProgress("error", msg);
    throw new Error(msg);
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
    // Allow full paths, e.g. /usr/libexec/docker/cli-plugins/docker-compose
    if (cfg.composeBin.includes("compose")) {
      return { cmd: cfg.composeBin, baseArgs: [] };
    }
    return { cmd: cfg.composeBin, baseArgs: [] };
  }
  // Prefer Compose v2 plugin — v1 breaks on `docker-compose up --force-recreate` with modern Engine.
  if (await commandExists("docker", ["compose", "version"], cfg.composeDir)) {
    return { cmd: "docker", baseArgs: ["compose"] };
  }
  const composePluginCandidates = [
    "/usr/libexec/docker/cli-plugins/docker-compose",
    "/usr/local/lib/docker/cli-plugins/docker-compose",
  ];
  for (const plugin of composePluginCandidates) {
    if (await commandExists(plugin, ["version"], cfg.composeDir)) {
      return { cmd: plugin, baseArgs: [] };
    }
  }
  if (await commandExists("docker-compose", ["version"], cfg.composeDir)) {
    emitProgress(
      "output",
      "Warning: using legacy docker-compose v1; targeted updates use --no-deps. Install Compose v2 or set APP_UPDATE_COMPOSE_BIN=docker."
    );
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

/** docker-compose 1.29.x + modern Docker Engine: recreate reads removed image field ContainerConfig */
function isDockerComposeContainerConfigError(message: string): boolean {
  const low = message.toLowerCase();
  return low.includes("containerconfig") || low.includes("keyerror: 'containerconfig'");
}

function summarizeUpdateError(message: string): string {
  if (isDockerComposeContainerConfigError(message)) {
    return [
      "Docker Compose v1 (docker-compose) failed while recreating dependency containers (mysql/redis).",
      "Routine updates should only rebuild api, worker, web with --no-deps.",
      "On the host: set APP_UPDATE_COMPOSE_BIN=docker (Compose v2) or upgrade the API image, then retry.",
      "Emergency manual deploy: docker compose -p future-radius up -d --build --no-deps api worker web",
    ].join("\n");
  }
  if (isDockerPortBindConflict(message)) {
    const ports = extractDockerBindPorts(message);
    const list = ports.length ? ports.join(", ") : "3306, 3001";
    return [
      `Host port conflict (${list}): another container is already using mysql (3306) and/or waha (3001).`,
      `The updater stops conflicting containers and retries; routine updates only rebuild api, worker, web.`,
      `On the host: docker ps --format "table {{.Names}}\\t{{.Ports}}"`,
    ].join("\n");
  }
  if (message.length > 1200) {
    return `${message.slice(0, 400)}\n…\n${message.slice(-700)}`;
  }
  return message;
}

function portConflictHints(ports: string[]): string[] {
  const list = ports.length ? ports.join(", ") : "3306, 3001, …";
  return [
    `تعارض منافذ على المضيف (${list}). غالباً حاوية أخرى أو نسخة ثانية من نفس المشروع، أو MySQL مثبت على النظام يستخدم 3306.`,
    `Host port conflict (${list}). Another container, a second stack, or host mysqld may already bind these ports.`,
    `إن كان هناك مشروعان Compose مختلفان الاسم على نفس المضيف، عيّن APP_UPDATE_COMPOSE_PROJECT_NAME ليطابق بادئة الحاويات (مثل future-radius من future-radius_mysql_1).`,
    `If two Compose stacks exist on the host, set APP_UPDATE_COMPOSE_PROJECT_NAME to match container prefixes (e.g. future-radius from future-radius_mysql_1).`,
    `التحديث يعيد المحاولة بعد إيقاف/إزالة حاويات mysql وwaha (افتراضياً مرّتان مع إزالة أقوى في الثانية؛ volumes تبقى). APP_UPDATE_COMPOSE_RECYCLE_MAX_PASSES و APP_UPDATE_COMPOSE_KILL_BEFORE_RECYCLE.`,
    `Updates recycle mysql,waha then retries compose up (default 2 passes; second pass uses kill if needed). Tune APP_UPDATE_COMPOSE_RECYCLE_MAX_PASSES / APP_UPDATE_COMPOSE_KILL_BEFORE_RECYCLE.`,
    `على الخادم: docker ps --format "table {{.Names}}\\t{{.Ports}}" ثم أوقف الحاوية التي تعرض 3306 أو 3001 (docker stop <name>).`,
    `On the host: docker ps --format "table {{.Names}}\\t{{.Ports}}" and docker stop the container publishing the conflicting port.`,
  ];
}

function composeFileArgs(cfg: ReturnType<typeof getUpdateConfig>): string[] {
  return cfg.composeFile ? ["-f", cfg.composeFile] : [];
}

/** `-p project` so recycle/up target the same stack as production (fixes duplicate dirs / COMPOSE_PROJECT_NAME drift). */
function composeProjectArgs(cfg: ReturnType<typeof getUpdateConfig>): string[] {
  return cfg.composeProjectName ? ["-p", cfg.composeProjectName] : [];
}

function composeLeadArgs(
  compose: { cmd: string; baseArgs: string[] },
  cfg: ReturnType<typeof getUpdateConfig>
): string[] {
  return [...compose.baseArgs, ...composeProjectArgs(cfg), ...composeFileArgs(cfg)];
}

function formatComposeShellLine(
  compose: { cmd: string; baseArgs: string[] },
  cfg: ReturnType<typeof getUpdateConfig>,
  tail: string[]
): string {
  return [compose.cmd, ...composeLeadArgs(compose, cfg), ...tail].filter(Boolean).join(" ");
}

/** Stop containers on the host that publish given TCP ports (frees 3306 / 3001 bind conflicts). */
async function stopContainersPublishingPorts(
  ports: string[],
  cwd: string
): Promise<void> {
  const unique = [...new Set(ports.filter((p) => /^\d+$/.test(p)))];
  for (const port of unique) {
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["ps", "-q", "--filter", `publish=${port}`],
        { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      const ids = String(stdout || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const id of ids) {
        emitProgress("output", `Stopping container ${id.slice(0, 12)} using host port ${port}...`);
        await runCommand("docker", ["stop", "-t", "15", id], cwd).catch(() => {});
        await runCommand("docker", ["rm", "-f", id], cwd).catch(() => {});
      }
    } catch {
      // ignore — best effort
    }
  }
}

/** Stop and remove named compose services (containers only; named volumes unchanged). */
async function runComposeRecycle(
  compose: { cmd: string; baseArgs: string[] },
  cfg: ReturnType<typeof getUpdateConfig>,
  services: string[],
  opts: { aggressive?: boolean; ports?: string[] }
): Promise<void> {
  const base = composeLeadArgs(compose, cfg);
  const aggressive = Boolean(opts.aggressive) || cfg.composeKillBeforeRecycle;

  if (services.length > 0) {
    await runCommand(compose.cmd, [...base, "stop", "-t", "15", ...services], cfg.composeDir).catch(() => {});
    if (aggressive) {
      await runCommand(compose.cmd, [...base, "kill", ...services], cfg.composeDir).catch(() => {});
    }
    await runCommand(compose.cmd, [...base, "rm", "-sf", ...services], cfg.composeDir).catch(async () => {
      await runCommand(compose.cmd, [...base, "stop", "-t", "5", ...services], cfg.composeDir).catch(() => {});
      await runCommand(compose.cmd, [...base, "rm", "-f", ...services], cfg.composeDir).catch(() => {});
    });
  }

  const ports = opts.ports?.length ? opts.ports : ["3306", "3001"];
  await stopContainersPublishingPorts(ports, cfg.composeDir);
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

/** Check if git repo is in a safe state (no conflicts, no uncommitted changes) */
async function checkGitStatus(cfg: ReturnType<typeof getUpdateConfig>): Promise<{ safe: boolean; reason?: string }> {
  try {
    // Check for merge conflicts
    const status = await runGit(cfg.gitBin, ["status", "--porcelain"], cfg.repoDir);
    if (status.includes("UU") || status.includes("AA") || status.includes("DD")) {
      return { safe: false, reason: "merge_conflict_detected" };
    }
    
    // Check if there's a MERGE_HEAD file (incomplete merge)
    const mergeHead = await readFile(`${cfg.repoDir}/.git/MERGE_HEAD`).catch(() => null);
    if (mergeHead) {
      return { safe: false, reason: "incomplete_merge" };
    }
    
    // Check for uncommitted changes (should be none)
    const diffStatus = await runGit(cfg.gitBin, ["diff", "--name-only"], cfg.repoDir);
    if (diffStatus) {
      return { safe: false, reason: "uncommitted_changes" };
    }
    
    return { safe: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { safe: false, reason: `git_status_check_failed: ${msg}` };
  }
}

/** Safely abort a failed update and restore git state */
async function abortFailedUpdate(cfg: ReturnType<typeof getUpdateConfig>, originalCommit: string): Promise<void> {
  try {
    emitProgress("step", { msg: "🔄 Attempting to restore to previous state...", step: 0 });
    
    // Check if we're in a merge state
    const mergeHead = await readFile(`${cfg.repoDir}/.git/MERGE_HEAD`).catch(() => null);
    if (mergeHead) {
      emitProgress("output", "Aborting incomplete merge...");
      await runGit(cfg.gitBin, ["merge", "--abort"], cfg.repoDir).catch(() => {});
    }
    
    // Reset to original commit
    emitProgress("output", `Resetting to commit ${originalCommit.slice(0, 12)}...`);
    await runGit(cfg.gitBin, ["reset", "--hard", originalCommit], cfg.repoDir);
    
    emitProgress("output", "✅ Repository restored to previous state");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitProgress("error", `Failed to restore state: ${msg}`);
  }
}

async function runUpdateProcess(cfg: ReturnType<typeof getUpdateConfig>) {
  // Check circuit breaker
  if (!updateCircuitBreaker.canExecute()) {
    const timeUntilReset = updateCircuitBreaker.resetTimeout - (Date.now() - updateCircuitBreaker.lastFailureTime);
    throw new Error(
      `Update service in cooldown after ${updateCircuitBreaker.failures} failures. Try again in ${Math.ceil(timeUntilReset / 1000)}s.`
    );
  }

  // Pre-flight checks
  emitProgress("step", { msg: "🔍 Running pre-flight checks...", step: 0 });
  
  let gitStatus: { safe: boolean; reason?: string };
  try {
    gitStatus = await withTimeout(
      checkGitStatus(cfg),
      15_000,
      "git-status-check"
    );
  } catch (e) {
    throw new Error(`Pre-flight check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  if (!gitStatus.safe) {
    throw new Error(`Repository not in safe state: ${gitStatus.reason}`);
  }
  emitProgress("output", "✅ Repository status OK");
  
  let originalCommit: string;
  try {
    originalCommit = await withTimeout(
      runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
      10_000,
      "get-original-commit"
    );
  } catch (e) {
    throw new Error(`Cannot read current commit: ${e instanceof Error ? e.message : String(e)}`);
  }

  const steps: string[] = [];
  let updateSucceeded = false;

  try {
    // Step 1: Fetch
    emitProgress("step", { msg: "$ git fetch origin main", step: 1 });
    steps.push("git fetch");
    try {
      await withTimeout(
        runGit(cfg.gitBin, ["fetch", cfg.remote, cfg.branch], cfg.repoDir),
        30_000,
        "git-fetch"
      );
    } catch (e) {
      throw new Error(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step 2: Checkout
    emitProgress("step", { msg: "$ git checkout main", step: 2 });
    steps.push("git checkout");
    try {
      await withTimeout(
        runGit(cfg.gitBin, ["checkout", cfg.branch], cfg.repoDir),
        10_000,
        "git-checkout"
      );
    } catch (e) {
      throw new Error(`Checkout failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const before = await withTimeout(
      runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
      10_000,
      "get-before-commit"
    );
    emitProgress("output", `Current commit: ${before.slice(0, 12)}`);

    // Step 3: Pull with conflict detection
    emitProgress("step", { msg: "$ git pull --ff-only origin main", step: 3 });
    steps.push("git pull --ff-only");
    try {
      await withTimeout(
        runGit(cfg.gitBin, ["pull", "--ff-only", cfg.remote, cfg.branch], cfg.repoDir),
        30_000,
        "git-pull"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("fatal: Not possible to fast-forward") || msg.includes("conflict")) {
        throw new Error(`Git merge conflict: ${msg}. Manual resolution required.`);
      }
      throw e;
    }

    const after = await withTimeout(
      runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
      10_000,
      "get-after-commit"
    );
    emitProgress("output", `Updated to commit: ${after.slice(0, 12)}`);

    let composeStatus: string | undefined;
    if (cfg.composeEnabled) {
      const compose = await withTimeout(
        resolveComposeCommand(cfg),
        10_000,
        "resolve-compose"
      );
      const targeted = cfg.composeUpServices.length > 0;
      const upTail: string[] = ["up", "-d", "--build"];
      if (targeted) {
        // Do not recreate mysql/redis/freeradius; --force-recreate on compose v1 triggers ContainerConfig errors.
        upTail.push("--no-deps", ...cfg.composeUpServices);
      } else if (cfg.composeRemoveOrphans) {
        upTail.push("--remove-orphans");
      }
      const composeUpArgs = [...composeLeadArgs(compose, cfg), ...upTail];
      const serviceHint = targeted ? cfg.composeUpServices.join(", ") : "all services";

      emitProgress("step", { msg: `$ ${formatComposeShellLine(compose, cfg, upTail)}`, step: 4 });
      emitProgress(
        "output",
        targeted
          ? `Compose targets (mysql/waha left running): ${serviceHint}`
          : `Compose targets: ${serviceHint}`
      );
      steps.push(`docker compose ${upTail.join(" ")}`);

      let composeSuccess = false;
      for (let pass = 0; pass <= cfg.composeRecycleMaxPasses; pass += 1) {
        try {
          await withTimeout(
            runCommand(compose.cmd, composeUpArgs, cfg.composeDir, true),
            cfg.composeBuildTimeoutMs,
            `docker-compose-up-pass-${pass}`
          );
          composeSuccess = true;
          break;
        } catch (upErr) {
          const msg = upErr instanceof Error ? upErr.message : String(upErr);
          if (isDockerComposeContainerConfigError(msg) && compose.cmd === "docker-compose" && targeted) {
            const v2 = await commandExists("docker", ["compose", "version"], cfg.composeDir);
            if (v2) {
              emitProgress(
                "output",
                "ContainerConfig error from docker-compose v1; retrying with docker compose (v2) and --no-deps..."
              );
              const v2Args = [...composeLeadArgs({ cmd: "docker", baseArgs: ["compose"] }, cfg), ...upTail];
              await withTimeout(
                runCommand("docker", v2Args, cfg.composeDir, true),
                cfg.composeBuildTimeoutMs,
                "docker-compose-v2-fallback"
              );
              composeSuccess = true;
              break;
            }
          }
          const canRecycle =
            cfg.composeRetryRecycleOnPortConflict &&
            isDockerPortBindConflict(msg) &&
            cfg.composeRecycleServices.length > 0 &&
            pass < cfg.composeRecycleMaxPasses;
          if (!canRecycle) throw upErr;

          const conflictPorts = extractDockerBindPorts(msg);
          emitProgress(
            "output",
            `Port conflict (${conflictPorts.join(", ") || "3306, 3001"}). Recycling ${cfg.composeRecycleServices.join(",")} (pass ${pass + 1}/${cfg.composeRecycleMaxPasses})...`
          );
          steps.push(`compose recycle ${cfg.composeRecycleServices.join(",")} (pass ${pass + 1}/${cfg.composeRecycleMaxPasses})`);

          try {
            await withTimeout(
              runComposeRecycle(compose, cfg, cfg.composeRecycleServices, {
                aggressive: pass > 0 || cfg.composeKillBeforeRecycle,
                ports: conflictPorts.length ? conflictPorts : ["3306", "3001"],
              }),
              90_000,
              `docker-compose-recycle-pass-${pass}`
            );
          } catch (recycleErr) {
            throw new Error(`Compose recycle failed: ${recycleErr instanceof Error ? recycleErr.message : String(recycleErr)}`);
          }
        }
      }

      if (!composeSuccess) {
        throw new Error("Docker compose failed after all retry attempts");
      }

      emitProgress("step", { msg: `$ ${compose.cmd} compose ps`, step: 5 });
      steps.push("docker compose ps");
      try {
        const ps = await withTimeout(
          runCommand(compose.cmd, [...composeLeadArgs(compose, cfg), "ps"], cfg.composeDir, true),
          30_000,
          "docker-compose-ps"
        );
        composeStatus = ps.stdout;
      } catch (e) {
        emitProgress("output", `Warning: Failed to get compose status: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const [currentCommitDate, remoteCommit, remoteCommitDate] = await Promise.all([
      withTimeout(resolveCommitDate(cfg.gitBin, cfg.repoDir, after), 10_000, "get-commit-date"),
      withTimeout(
        runGit(cfg.gitBin, ["ls-remote", cfg.remote, `refs/heads/${cfg.branch}`], cfg.repoDir).then((raw) =>
          (raw.split(/\s+/)[0] || "").trim()
        ),
        15_000,
        "ls-remote"
      ),
      withTimeout(
        runGit(cfg.gitBin, ["show", "-s", "--format=%cI", `${cfg.remote}/${cfg.branch}`], cfg.repoDir),
        10_000,
        "get-remote-date"
      ).catch(() => ""),
    ]);

    updateSucceeded = true;
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

    lastSuccessfulCommit = after;
    lastUpdateError = null;
    updateCircuitBreaker.recordSuccess();

    emitProgress("complete", {
      changed: before !== after,
      beforeCommit: before,
      afterCommit: after,
      steps,
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
  } catch (e) {
    emitProgress("error", `Update failed. Attempting to restore...`);
    updateCircuitBreaker.recordFailure();
    
    try {
      await withTimeout(
        abortFailedUpdate(cfg, originalCommit),
        30_000,
        "abort-update-rollback"
      );
    } catch (rollbackErr) {
      emitProgress("error", `⚠️ Rollback also failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`);
      emitProgress("error", `Manual intervention required: git reset --hard ${originalCommit}`);
    }

    const errorMsg = summarizeUpdateError(e instanceof Error ? e.message : String(e));
    lastUpdateError = {
      timestamp: new Date().toISOString(),
      message: errorMsg,
    };

    throw new Error(errorMsg);
  } finally {
    // Final safety check
    if (!updateSucceeded) {
      try {
        await withTimeout(
          checkGitStatus(cfg),
          10_000,
          "final-git-status-check"
        ).catch((err) => {
          emitProgress("error", `Final status check failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch (e) {
        console.error("[updates] final status check error", e);
      }
    }
  }
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
    const persistedErr =
      typeof state.lastError === "string" && state.lastError.trim()
        ? { timestamp: state.lastRunAt ?? "", message: state.lastError }
        : null;
    const err = lastUpdateError ?? persistedErr;
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
      updateInProgress,
      composeUpServices: cfg.composeUpServices.length > 0 ? cfg.composeUpServices : null,
      lastError: err
        ? { timestamp: err.timestamp || state.lastRunAt || "", message: err.message.slice(0, 4000) }
        : null,
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
  const rawEnabled = req.body?.enabled;
  if (typeof rawEnabled !== "boolean") {
    res.status(400).json({ error: "invalid_body", detail: "enabled_boolean_required" });
    return;
  }
  const enabled = rawEnabled;
  const cfg = getUpdateConfig();
  try {
    await writeRuntimeEnabled(cfg.runtimeFile, enabled);
    res.json({ ok: true, runtimeEnabled: enabled, effectiveEnabled: enabled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "feature_toggle_failed";
    res.status(500).json({ error: "feature_toggle_failed", detail: message });
  }
});

/** Health check for update service - shows security status */
router.get("/updates/health", async (_req, res) => {
  const cfg = getUpdateConfig();
  try {
    const gitStatus = await checkGitStatus(cfg);
    res.json({
      ok: true,
      updateInProgress,
      gitRepoSafe: gitStatus.safe,
      gitRepoIssue: gitStatus.reason || null,
      lastSuccessfulCommit,
      lastError: lastUpdateError ? { 
        timestamp: lastUpdateError.timestamp, 
        message: lastUpdateError.message.slice(0, 500)
      } : null,
      safetyFeatures: {
        lockingEnabled: true,
        rollbackOnFailure: true,
        gitConflictDetection: true,
        preFlightChecks: true,
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "health_check_failed";
    res.status(500).json({ error: "health_check_failed", detail: message, updateInProgress });
  }
});

router.post("/updates/check", async (_req, res) => {
  const cfg = getUpdateConfig();
  try {
    // Ensure local refs for configured branch are fresh before commit/date checks.
    await runGit(cfg.gitBin, ["fetch", cfg.remote, cfg.branch], cfg.repoDir);
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
  
  // Check if update is already in progress
  if (updateInProgress) {
    res.status(429).json({ 
      error: "update_in_progress",
      detail: "An update is already in progress. Please wait for it to complete."
    });
    return;
  }
  
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
  
  // Mark update as in progress
  updateInProgress = true;
  
  // Stream response using Server-Sent Events
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  let closed = false;
  const closeConnection = () => {
    closed = true;
    updateInProgress = false; // ✅ ALWAYS release the lock
    res.end();
  };

  // Timeout protection: ensure connection closes after max time
  const timeoutHandle = setTimeout(() => {
    if (!closed) {
      emitProgress("error", "Update exceeded maximum time limit");
      closeConnection();
    }
  }, 30 * 60_000); // 30 minute hard limit

  res.on("close", closeConnection);
  res.on("error", closeConnection);

  const progressListener = (event: any) => {
    if (!closed) {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (e) {
        console.error("[updates] Failed to write to response:", e);
      }
    }
  };

  updateProgressEmitter.on("progress", progressListener);

  try {
    const result = await runUpdateProcess(cfg);
    if (!closed) {
      res.write(`data: ${JSON.stringify({ type: "final", data: result })}\n\n`);
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : "run_failed";
    const message = summarizeUpdateError(raw);
    try {
      if (/spawn .* ENOENT/i.test(message) || message.includes("compose_binary_not_found")) {
        if (!closed) {
          res.write(
            `data: ${JSON.stringify({ type: "error", data: { error: "update_runtime_binary_missing", detail: "Missing runtime binary. Set APP_UPDATE_GIT_BIN and/or APP_UPDATE_COMPOSE_BIN to valid commands/paths in API environment." } })}\n\n`
          );
        }
      } else if (isDockerPortBindConflict(raw)) {
        const ports = extractDockerBindPorts(raw);
        if (!closed) {
          res.write(
            `data: ${JSON.stringify({ type: "error", data: { error: "update_port_conflict", detail: message, ports: ports.length ? ports : null, hints: portConflictHints(ports) } })}\n\n`
          );
        }
      } else {
        if (!closed) {
          res.write(`data: ${JSON.stringify({ type: "error", data: { error: "update_run_failed", detail: message } })}\n\n`);
        }
      }
      await writeUpdateState(cfg.updateStateFile, {
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: message,
      }).catch((e) => {
        console.error("[updates] Failed to write error state:", e);
      });
    } catch (writeErr) {
      console.error("[updates] Error during error handling:", writeErr);
    }
  } finally {
    try {
      clearTimeout(timeoutHandle);
      updateProgressEmitter.removeListener("progress", progressListener);
      closeConnection();
    } catch (e) {
      console.error("[updates] Error during cleanup:", e);
    }
  }
});

let autoUpdateStarted = false;
export function startAutoUpdateLoop(): void {
  if (autoUpdateStarted) return;
  autoUpdateStarted = true;
  const cfg = getUpdateConfig();
  if (cfg.autoIntervalMinutes <= 0) return;
  
  const tick = async () => {
    // 🛡️ Protection: Never let auto-update crash the main loop
    try {
      // Skip if update is already in progress or if circuit breaker is open
      if (updateInProgress) {
        console.log("[updates:auto] Update already in progress, skipping tick");
        return;
      }
      
      if (!updateCircuitBreaker.canExecute()) {
        console.log("[updates:auto] Circuit breaker open, skipping until cooldown expires");
        return;
      }

      const runtimeEnabled = await readRuntimeEnabled(cfg.runtimeFile).catch(() => null);
      const effectiveEnabled = runtimeEnabled ?? cfg.enabled;
      if (!effectiveEnabled) {
        console.log("[updates:auto] Updates disabled");
        return;
      }

      // Get commits with timeout
      const localCommit = await withTimeout(
        runGit(cfg.gitBin, ["rev-parse", "HEAD"], cfg.repoDir),
        10_000,
        "auto-update-local-commit"
      ).catch((e) => {
        console.error("[updates:auto] Failed to get local commit:", e);
        return null;
      });

      if (!localCommit) {
        console.error("[updates:auto] Cannot read local commit, skipping");
        return;
      }

      const remoteCommit = await withTimeout(
        runGit(cfg.gitBin, ["ls-remote", cfg.remote, `refs/heads/${cfg.branch}`], cfg.repoDir).then((raw) =>
          (raw.split(/\s+/)[0] || "").trim()
        ),
        15_000,
        "auto-update-remote-commit"
      ).catch((e) => {
        console.error("[updates:auto] Failed to get remote commit:", e);
        return null;
      });

      // Update state
      await writeUpdateState(cfg.updateStateFile, {
        lastCheckedAt: new Date().toISOString(),
        remoteCommit: remoteCommit || null,
      }).catch((e) => {
        console.error("[updates:auto] Failed to write update state:", e);
      });

      if (!remoteCommit || remoteCommit === localCommit) {
        console.log("[updates:auto] No new updates available");
        return;
      }

      console.log("[updates:auto] New update available, starting update process");
      // Note: runUpdateProcess handles its own error management
      await runUpdateProcess(cfg);
    } catch (error) {
      // 🛡️ CRITICAL: Never crash the auto-update loop
      const message = error instanceof Error ? error.message : String(error);
      console.error("[updates:auto] Tick failed:", message);
      
      try {
        await writeUpdateState(cfg.updateStateFile, {
          lastRunAt: new Date().toISOString(),
          lastStatus: "error",
          lastError: message.slice(0, 500),
        }).catch((e) => {
          console.error("[updates:auto] Failed to save error state:", e);
        });
      } catch (stateErr) {
        console.error("[updates:auto] Failed to handle error state:", stateErr);
      }
      
      // Don't rethrow - let the interval continue
    }
  };

  // Run first tick immediately
  void tick().catch((e) => {
    console.error("[updates:auto] First tick crashed:", e);
  });

  // Set up interval for periodic checks
  const intervalMs = cfg.autoIntervalMinutes * 60_000;
  const intervalHandle = setInterval(() => {
    void tick().catch((e) => {
      console.error("[updates:auto] Interval tick crashed:", e);
    });
  }, intervalMs);

  // Optional: Allow graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[updates:auto] Received SIGTERM, clearing update interval");
    clearInterval(intervalHandle);
  });
}

export default router;
