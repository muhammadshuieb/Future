import { statfs } from "node:fs";
import { promisify } from "node:util";
import { hostDiskBytes } from "./metrics.service.js";

const statfsAsync = promisify(statfs);

const MOUNT = process.env.DISK_MONITOR_MOUNT || "/";
const SAMPLE_INTERVAL_MS = Math.max(15_000, Number(process.env.DISK_MONITOR_INTERVAL_MS) || 60_000);

let lastSnapshot: { total: number; free: number; used: number; pct: number; sampledAt: string } | null = null;
let timer: NodeJS.Timeout | null = null;

async function sampleOnce(): Promise<void> {
  try {
    const s = await statfsAsync(MOUNT);
    const blockSize = Number(s.bsize) || 4096;
    const total = Number(s.blocks) * blockSize;
    const free = Number(s.bavail) * blockSize;
    const used = Math.max(0, total - free);
    hostDiskBytes.set({ mount: MOUNT, state: "total" }, total);
    hostDiskBytes.set({ mount: MOUNT, state: "used" }, used);
    hostDiskBytes.set({ mount: MOUNT, state: "free" }, free);
    lastSnapshot = {
      total,
      free,
      used,
      pct: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      sampledAt: new Date().toISOString(),
    };
  } catch {
    // statfs can fail on read-only or virtual mounts; leave previous snapshot in place.
  }
}

export function startDiskMonitor(): void {
  if (timer) return;
  void sampleOnce();
  timer = setInterval(() => void sampleOnce(), SAMPLE_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function getDiskSnapshot() {
  return lastSnapshot;
}
