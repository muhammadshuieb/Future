/**
 * Static catalog mapping each Prometheus alert + each common runtime symptom
 * to a structured remediation hint. The frontend renders these next to firing
 * alerts so the operator gets "what + why + how to fix" without leaving the panel.
 *
 * Each entry is intentionally short and language-agnostic; the i18n layer in the
 * frontend supplies localised copies. Add new entries here as alerts are added.
 */
export type Severity = "info" | "warning" | "critical";

export interface RemediationStep {
  i18n: string;        // i18n key the frontend will translate
  command?: string;    // optional copy-paste shell command
}

export interface RemediationEntry {
  alertname: string;
  severity: Severity;
  cause_i18n: string;
  steps: RemediationStep[];
  references?: { i18n: string; href: string }[];
}

export const REMEDIATION_CATALOG: Record<string, RemediationEntry> = {
  AuthFailureSpike: {
    alertname: "AuthFailureSpike",
    severity: "warning",
    cause_i18n: "remediation.AuthFailureSpike.cause",
    steps: [
      { i18n: "remediation.AuthFailureSpike.step.checkLogs" },
      {
        i18n: "remediation.AuthFailureSpike.step.recentFails",
        command: "docker compose logs api --tail 200 | grep auth_failed",
      },
      {
        i18n: "remediation.AuthFailureSpike.step.bruteForceKeys",
        command: "docker compose exec redis redis-cli KEYS 'bf:*'",
      },
      { i18n: "remediation.AuthFailureSpike.step.review" },
    ],
  },
  BruteForceDetected: {
    alertname: "BruteForceDetected",
    severity: "critical",
    cause_i18n: "remediation.BruteForceDetected.cause",
    steps: [
      {
        i18n: "remediation.BruteForceDetected.step.listKeys",
        command: "docker compose exec redis redis-cli KEYS 'bf:ip:*'",
      },
      {
        i18n: "remediation.BruteForceDetected.step.blockIp",
        command: "iptables -A INPUT -s <attacker_ip> -j DROP",
      },
      { i18n: "remediation.BruteForceDetected.step.tightenLimit" },
    ],
  },
  SyntheticRadiusFailing: {
    alertname: "SyntheticRadiusFailing",
    severity: "critical",
    cause_i18n: "remediation.SyntheticRadiusFailing.cause",
    steps: [
      {
        i18n: "remediation.SyntheticRadiusFailing.step.containerStatus",
        command: "docker compose ps freeradius",
      },
      {
        i18n: "remediation.SyntheticRadiusFailing.step.logs",
        command: "docker compose logs freeradius --tail 80",
      },
      {
        i18n: "remediation.SyntheticRadiusFailing.step.dbReachable",
        command: "docker compose exec freeradius mysql -uradius -p$RADIUS_DB_PASSWORD -h mysql -e 'SELECT 1'",
      },
      {
        i18n: "remediation.SyntheticRadiusFailing.step.restart",
        command: "docker compose restart freeradius",
      },
    ],
  },
  CoaTimeoutSpike: {
    alertname: "CoaTimeoutSpike",
    severity: "warning",
    cause_i18n: "remediation.CoaTimeoutSpike.cause",
    steps: [
      { i18n: "remediation.CoaTimeoutSpike.step.checkNas" },
      {
        i18n: "remediation.CoaTimeoutSpike.step.verifySecret",
        command: "docker compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD radius -e \"SELECT nasname,shortname FROM nas WHERE nasname='<NAS_IP>'\"",
      },
      { i18n: "remediation.CoaTimeoutSpike.step.routerOs" },
      {
        i18n: "remediation.CoaTimeoutSpike.step.connectivity",
        command: "docker compose exec freeradius nc -uvz <NAS_IP> 3799",
      },
    ],
  },
  StaleSessionsSpike: {
    alertname: "StaleSessionsSpike",
    severity: "warning",
    cause_i18n: "remediation.StaleSessionsSpike.cause",
    steps: [
      { i18n: "remediation.StaleSessionsSpike.step.identifyNas" },
      { i18n: "remediation.StaleSessionsSpike.step.checkInterimUpdate" },
      { i18n: "remediation.StaleSessionsSpike.step.acceptable" },
    ],
  },
  WorkerCycleSlow: {
    alertname: "WorkerCycleSlow",
    severity: "warning",
    cause_i18n: "remediation.WorkerCycleSlow.cause",
    steps: [
      { i18n: "remediation.WorkerCycleSlow.step.dbCheck" },
      { i18n: "remediation.WorkerCycleSlow.step.indexes" },
      {
        i18n: "remediation.WorkerCycleSlow.step.applyIndexes",
        command: "cd api && npm run apply:project-indexes",
      },
    ],
  },
  BullMqQueueLag: {
    alertname: "BullMqQueueLag",
    severity: "warning",
    cause_i18n: "remediation.BullMqQueueLag.cause",
    steps: [
      {
        i18n: "remediation.BullMqQueueLag.step.workerStatus",
        command: "docker compose ps worker",
      },
      {
        i18n: "remediation.BullMqQueueLag.step.queueState",
        command: "docker compose exec redis redis-cli LLEN bull:radius-manager:waiting",
      },
      {
        i18n: "remediation.BullMqQueueLag.step.restartWorker",
        command: "docker compose restart worker",
      },
    ],
  },
  MysqlPoolExhausted: {
    alertname: "MysqlPoolExhausted",
    severity: "warning",
    cause_i18n: "remediation.MysqlPoolExhausted.cause",
    steps: [
      { i18n: "remediation.MysqlPoolExhausted.step.processList",
        command: "docker compose exec mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD -e 'SHOW FULL PROCESSLIST'",
      },
      { i18n: "remediation.MysqlPoolExhausted.step.raiseLimit" },
      { i18n: "remediation.MysqlPoolExhausted.step.findSlow" },
    ],
  },
  ApiTargetDown: {
    alertname: "ApiTargetDown",
    severity: "critical",
    cause_i18n: "remediation.ApiTargetDown.cause",
    steps: [
      { i18n: "remediation.ApiTargetDown.step.containerStatus",
        command: "docker compose ps api",
      },
      { i18n: "remediation.ApiTargetDown.step.logs",
        command: "docker compose logs api --tail 100",
      },
      { i18n: "remediation.ApiTargetDown.step.restart",
        command: "docker compose restart api",
      },
    ],
  },
  WorkerTargetDown: {
    alertname: "WorkerTargetDown",
    severity: "critical",
    cause_i18n: "remediation.WorkerTargetDown.cause",
    steps: [
      { i18n: "remediation.WorkerTargetDown.step.containerStatus",
        command: "docker compose ps worker",
      },
      { i18n: "remediation.WorkerTargetDown.step.logs",
        command: "docker compose logs worker --tail 100",
      },
      { i18n: "remediation.WorkerTargetDown.step.restart",
        command: "docker compose restart worker",
      },
    ],
  },
};

/** Symptom-based catalog (no Prometheus alert needed). Used by the live cards
 * when a metric crosses a threshold but no alert has fired yet — useful in the
 * grace window before `for: 5m`. */
export const SYMPTOM_CATALOG: Record<string, RemediationEntry> = {
  highMemoryUsage: {
    alertname: "highMemoryUsage",
    severity: "warning",
    cause_i18n: "remediation.highMemoryUsage.cause",
    steps: [
      { i18n: "remediation.highMemoryUsage.step.identify" },
      { i18n: "remediation.highMemoryUsage.step.heap" },
      {
        i18n: "remediation.highMemoryUsage.step.restart",
        command: "docker compose restart api worker",
      },
    ],
  },
  highCpuUsage: {
    alertname: "highCpuUsage",
    severity: "warning",
    cause_i18n: "remediation.highCpuUsage.cause",
    steps: [
      { i18n: "remediation.highCpuUsage.step.topProc" },
      { i18n: "remediation.highCpuUsage.step.recentJobs" },
      { i18n: "remediation.highCpuUsage.step.scaleOut" },
    ],
  },
  diskNearFull: {
    alertname: "diskNearFull",
    severity: "critical",
    cause_i18n: "remediation.diskNearFull.cause",
    steps: [
      {
        i18n: "remediation.diskNearFull.step.diskUsage",
        command: "df -h",
      },
      {
        i18n: "remediation.diskNearFull.step.dockerCleanup",
        command: "docker system prune -a --volumes",
      },
      {
        i18n: "remediation.diskNearFull.step.oldBackups",
        command: "docker compose exec api ls -la /app/backups",
      },
    ],
  },
};

export function lookupRemediation(alertname: string): RemediationEntry | null {
  return REMEDIATION_CATALOG[alertname] ?? null;
}

export function lookupSymptom(symptom: string): RemediationEntry | null {
  return SYMPTOM_CATALOG[symptom] ?? null;
}
