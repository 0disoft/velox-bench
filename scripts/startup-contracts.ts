export const startupSchemaVersion = "velox.startup-benchmark/v2" as const;
export const startupSummarySchemaVersion = "velox.startup-summary/v1" as const;
export const startupSuite = "velox-startup" as const;
export const readyBoundary = "process-start-to-domcontentloaded-plus-two-animation-frames" as const;
export const warmupCount = 5 as const;
export const hostTimelineSchemaVersion = "velox.host-startup-timeline/v1" as const;
export const hostTimelineClock = "time-since-host-entry-monotonic" as const;
export const hostTimelinePrefix = "velox-bench-timeline " as const;
export const startupPhaseNames = [
  "host-entry",
  "config-loaded",
  "runtime-open-started",
  "window-create-started",
  "environment-create-started",
  "environment-created",
  "controller-created",
  "webview-created",
  "navigation-dispatched",
  "runtime-opened",
  "dom-2raf",
] as const;

export type StartupPhaseName = typeof startupPhaseNames[number];

export type HostStartupTimeline = {
  schemaVersion: typeof hostTimelineSchemaVersion;
  clock: typeof hostTimelineClock;
  phases: Array<{ name: StartupPhaseName; elapsedMs: number }>;
};

export type StartupEnvironment = {
  runner: "windows-2025";
  runnerImageVersion: string;
  windowsVersion: string;
  cpuModel: string;
  logicalProcessors: number;
  memoryBytes: number;
  bunVersion: string;
  repositoryCommit: string;
  runId: string;
  runAttempt: string;
  webView2Version: string;
};

export type StartupLaunch = {
  readyMs: number;
  hostExitAfterReadyMs: number;
  browserExitAfterHostMs: number;
  profileReleaseAfterHostMs: number;
  browserProcessId: number;
  hostTimeline: HostStartupTimeline;
};

export type StartupResult = {
  schemaVersion: typeof startupSchemaVersion;
  suite: typeof startupSuite;
  framework: "velox";
  frameworkRevision: string;
  evidenceLevel: "hosted-pinned-release" | "hosted-pinned-source" | "local-unverified-release";
  sample: number;
  fixtureSha256: string;
  outcome: "success" | "failure" | "timeout";
  startedAtUtc: string;
  finishedAtUtc: string;
  environment: StartupEnvironment;
  measurement: null | {
    readyBoundary: typeof readyBoundary;
    warmupCount: typeof warmupCount;
    fresh: StartupLaunch;
    warm: StartupLaunch;
  };
  failure: null | { phase: string; code: string };
};

export type StartupStatistics = { minMs: number; p50Ms: number; p95Ms: number; maxMs: number };

export type StartupSummary = {
  schemaVersion: typeof startupSummarySchemaVersion;
  suite: typeof startupSuite;
  framework: "velox";
  expected: 1 | 3 | 10;
  observed: number;
  missing: number;
  successful: number;
  failed: number;
  timedOut: number;
  publishable: boolean;
  evidenceLevels: string[];
  environmentGroups: Array<{ key: string; samples: number }>;
  fresh: StartupStatistics | null;
  warm: StartupStatistics | null;
};

export function validateStartupSummary(value: unknown): asserts value is StartupSummary {
  if (!value || typeof value !== "object") throw new Error("startup summary must be an object");
  const summary = value as Partial<StartupSummary>;
  if (summary.schemaVersion !== startupSummarySchemaVersion || summary.suite !== startupSuite || summary.framework !== "velox") {
    throw new Error("unsupported startup summary contract");
  }
  if (![1, 3, 10].includes(summary.expected ?? 0)) throw new Error("invalid expected startup samples");
  for (const field of ["observed", "missing", "successful", "failed", "timedOut"] as const) {
    if (!Number.isInteger(summary[field]) || (summary[field] ?? -1) < 0) throw new Error(`invalid startup summary ${field}`);
  }
  if (typeof summary.publishable !== "boolean" || !Array.isArray(summary.evidenceLevels) || summary.evidenceLevels.length < 1 ||
      summary.evidenceLevels.some((level) => !["hosted-pinned-release", "hosted-pinned-source", "local-unverified-release"].includes(level)) ||
      !Array.isArray(summary.environmentGroups) || summary.environmentGroups.length < 1 ||
      summary.environmentGroups.some((group) => !group.key || !Number.isInteger(group.samples) || group.samples < 1)) {
    throw new Error("invalid startup summary metadata");
  }
  for (const statistics of [summary.fresh, summary.warm]) {
    if (statistics === null) continue;
    if (!statistics || !finiteNonNegative(statistics.minMs) || !finiteNonNegative(statistics.p50Ms) ||
        !finiteNonNegative(statistics.p95Ms) || !finiteNonNegative(statistics.maxMs)) {
      throw new Error("invalid startup summary statistics");
    }
  }
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateHostTimeline(value: unknown, readyMs: number): asserts value is HostStartupTimeline {
  if (!value || typeof value !== "object") throw new Error("host startup timeline must be an object");
  const timeline = value as Partial<HostStartupTimeline>;
  if (timeline.schemaVersion !== hostTimelineSchemaVersion || timeline.clock !== hostTimelineClock ||
      !Array.isArray(timeline.phases) || timeline.phases.length !== startupPhaseNames.length) {
    throw new Error("invalid host startup timeline metadata");
  }
  let previous = -1;
  for (let index = 0; index < startupPhaseNames.length; index++) {
    const phase = timeline.phases[index];
    if (!phase || phase.name !== startupPhaseNames[index] || !finiteNonNegative(phase.elapsedMs) || phase.elapsedMs < previous) {
      throw new Error(`invalid host startup phase ${startupPhaseNames[index]}`);
    }
    previous = phase.elapsedMs;
  }
  if (timeline.phases[0].elapsedMs !== 0 || previous > readyMs) {
    throw new Error("host startup timeline exceeds process-to-ready measurement");
  }
}

export function parseHostTimelineOutput(stderr: string, readyMs: number): HostStartupTimeline {
  const lines = stderr.split(/\r?\n/).filter((line) => line.startsWith(hostTimelinePrefix));
  if (lines.length !== 1) throw new Error(`expected one host startup timeline, found ${lines.length}`);
  let value: unknown;
  try {
    value = JSON.parse(lines[0].slice(hostTimelinePrefix.length));
  } catch (error) {
    throw new Error("host startup timeline is not valid JSON", { cause: error });
  }
  validateHostTimeline(value, readyMs);
  return value;
}

function validLaunch(value: unknown): value is StartupLaunch {
  if (!value || typeof value !== "object") return false;
  const launch = value as Partial<StartupLaunch>;
  if (!(finiteNonNegative(launch.readyMs) && finiteNonNegative(launch.hostExitAfterReadyMs) &&
    finiteNonNegative(launch.browserExitAfterHostMs) && finiteNonNegative(launch.profileReleaseAfterHostMs) &&
    Number.isInteger(launch.browserProcessId) && (launch.browserProcessId ?? 0) > 0)) return false;
  try {
    validateHostTimeline(launch.hostTimeline, launch.readyMs);
    return true;
  } catch {
    return false;
  }
}

export function validateStartupResult(value: unknown): asserts value is StartupResult {
  if (!value || typeof value !== "object") throw new Error("startup result must be an object");
  const result = value as Partial<StartupResult>;
  if (result.schemaVersion !== startupSchemaVersion || result.suite !== startupSuite || result.framework !== "velox") {
    throw new Error("unsupported startup result contract");
  }
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "")) throw new Error("invalid startup framework revision");
  if (!result.evidenceLevel || !["hosted-pinned-release", "hosted-pinned-source", "local-unverified-release"].includes(result.evidenceLevel)) throw new Error("invalid startup evidence level");
  if (!Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9) throw new Error("invalid startup sample");
  if (!/^[0-9a-f]{64}$/.test(result.fixtureSha256 ?? "")) throw new Error("invalid startup fixture digest");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid startup outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid startup timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.runner !== "windows-2025" || environment.bunVersion !== "1.3.14" ||
      !environment.runnerImageVersion || !environment.windowsVersion || !environment.cpuModel || !environment.webView2Version ||
      !Number.isInteger(environment.logicalProcessors) || environment.logicalProcessors < 1 ||
      !Number.isInteger(environment.memoryBytes) || environment.memoryBytes < 1 ||
      !environment.repositoryCommit || !environment.runId || !environment.runAttempt) {
    throw new Error("invalid startup environment");
  }
  if (result.outcome === "success") {
    if (!result.measurement || result.failure !== null || result.measurement.readyBoundary !== readyBoundary || result.measurement.warmupCount !== warmupCount ||
        !validLaunch(result.measurement.fresh) || !validLaunch(result.measurement.warm)) {
      throw new Error("successful startup result is incomplete");
    }
  } else if (result.measurement !== null || !result.failure || !result.failure.phase || !/^[A-Z0-9_]+$/.test(result.failure.code)) {
    throw new Error("failed startup result is incomplete");
  }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

function statistics(values: number[]): StartupStatistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return { minMs: sorted[0], p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxMs: sorted[sorted.length - 1] };
}

function environmentKey(result: StartupResult): string {
  const environment = result.environment;
  return [environment.runnerImageVersion, environment.windowsVersion, environment.webView2Version].join("|");
}

export function buildStartupSummary(results: StartupResult[], expected: number): StartupSummary {
  if (![1, 3, 10].includes(expected)) throw new Error("expected startup sample count must be 1, 3, or 10");
  if (results.length === 0) throw new Error("no startup results were found");
  const seen = new Set<number>();
  const groups = new Map<string, number>();
  const evidenceLevels = new Set<string>();
  const fresh: number[] = [];
  const warm: number[] = [];
  let failed = 0;
  let timedOut = 0;
  for (const result of results) {
    validateStartupResult(result);
    if (seen.has(result.sample)) throw new Error(`duplicate startup sample ${result.sample}`);
    seen.add(result.sample);
    const key = environmentKey(result);
    groups.set(key, (groups.get(key) ?? 0) + 1);
    evidenceLevels.add(result.evidenceLevel);
    if (result.outcome === "success") {
      fresh.push(result.measurement!.fresh.readyMs);
      warm.push(result.measurement!.warm.readyMs);
    } else if (result.outcome === "timeout") timedOut += 1;
    else failed += 1;
  }
  const successful = fresh.length;
  const environmentGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, samples]) => ({ key, samples }));
  return {
    schemaVersion: startupSummarySchemaVersion,
    suite: startupSuite,
    framework: "velox",
    expected: expected as 1 | 3 | 10,
    observed: results.length,
    missing: Math.max(0, expected - results.length),
    successful,
    failed,
    timedOut,
    publishable: expected === 10 && results.length === 10 && successful === 10 && environmentGroups.length === 1 &&
      evidenceLevels.size === 1 && evidenceLevels.has("hosted-pinned-release"),
    evidenceLevels: [...evidenceLevels].sort(),
    environmentGroups,
    fresh: statistics(fresh),
    warm: statistics(warm),
  };
}
