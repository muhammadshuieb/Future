import { spawn } from "node:child_process";
import { synthCheckTotal } from "./metrics.service.js";

/**
 * Synthetic RADIUS check. Sends a deliberately-bad credential and expects Access-Reject.
 *
 * Two transports:
 *   1. Direct UDP via `radclient` (use only when the worker shares a routable network
 *      with freeradius — set SYNTH_RADIUS_VIA_DOCKER=0 + SYNTH_RADIUS_HOST_PORT=<host:port>).
 *   2. `docker exec <freeradius-container> radclient ...` against 127.0.0.1 inside the
 *      freeradius container's own network namespace. Works regardless of host networking
 *      because we enter the netns directly. This is the default.
 *
 * Tunables:
 *   SYNTH_RADIUS_VIA_DOCKER       default 1 (use `docker exec`)
 *   SYNTH_RADIUS_CONTAINER        default futureradius-freeradius-1
 *   SYNTH_RADIUS_HOST_PORT        default 127.0.0.1:1812 (used inside the freeradius netns)
 *   SYNTH_RADIUS_SECRET           default testing123
 *   SYNTH_RADIUS_USER             default synthetic-monitor (intentionally non-existent)
 *   SYNTH_RADIUS_TIMEOUT_MS       default 4000
 *   SYNTH_DISABLED=1              disables the probe entirely (CI)
 */
const HOST_PORT = process.env.SYNTH_RADIUS_HOST_PORT || "127.0.0.1:1812";
const SECRET = process.env.SYNTH_RADIUS_SECRET || "testing123";
const USER = process.env.SYNTH_RADIUS_USER || "synthetic-monitor";
const TIMEOUT_MS = Math.max(500, Number(process.env.SYNTH_RADIUS_TIMEOUT_MS) || 4000);
const VIA_DOCKER = String(process.env.SYNTH_RADIUS_VIA_DOCKER ?? "1") === "1";
const CONTAINER = process.env.SYNTH_RADIUS_CONTAINER || "futureradius-freeradius-1";

export async function runSyntheticRadiusProbe(): Promise<"ok" | "reject" | "error"> {
  if (process.env.SYNTH_DISABLED === "1") return "ok";
  const result = VIA_DOCKER ? await runViaDockerExec() : await runRadclientDirect();
  synthCheckTotal.inc({ result });
  if (result === "error") {
    console.warn(
      `[synthetic-radius] probe failed: transport=${VIA_DOCKER ? "docker-exec" : "direct"} target=${HOST_PORT}`
    );
  }
  return result;
}

function parseOutput(stdout: string, stderr: string): "ok" | "reject" | "error" {
  const out = `${stdout}\n${stderr}`;
  if (/Received Access-Reject/i.test(out)) return "reject";
  if (/Received Access-Accept/i.test(out)) return "ok";
  return "error";
}

function runRadclientDirect(): Promise<"ok" | "reject" | "error"> {
  return new Promise((resolve) => {
    const child = spawn(
      "radclient",
      ["-x", "-t", "3", "-r", "2", HOST_PORT, "auth", SECRET],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve("error");
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", () => { clearTimeout(timer); resolve("error"); });
    child.on("close", () => { clearTimeout(timer); resolve(parseOutput(stdout, stderr)); });
    try {
      child.stdin.end(`User-Name = ${USER}\nUser-Password = synthetic-bad\nNAS-IP-Address = 127.0.0.1\n`);
    } catch {
      clearTimeout(timer);
      resolve("error");
    }
  });
}

function runViaDockerExec(): Promise<"ok" | "reject" | "error"> {
  return new Promise((resolve) => {
    // `docker exec -i` directly into the freeradius container — no compose project lookup,
    // works as long as the container is named consistently (default compose naming).
    // -t 3 -r 2 provides headroom: FreeRADIUS occasionally replies in >1s under load
    // (rlm_sql lookups), and a single retry catches transient packet loss.
    const args = [
      "exec", "-i",
      CONTAINER,
      "radclient",
      "-x", "-t", "3", "-r", "2",
      HOST_PORT,
      "auth",
      SECRET,
    ];
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve("error");
    }, TIMEOUT_MS + 2000);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", () => { clearTimeout(timer); resolve("error"); });
    child.on("close", () => { clearTimeout(timer); resolve(parseOutput(stdout, stderr)); });
    try {
      child.stdin.end(`User-Name = ${USER}\nUser-Password = synthetic-bad\nNAS-IP-Address = 127.0.0.1\n`);
    } catch {
      clearTimeout(timer);
      resolve("error");
    }
  });
}
