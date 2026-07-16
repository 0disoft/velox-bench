export const recoverySchemaVersion = "velox.asset-transport-recovery/v1" as const;
export const recoverySummarySchemaVersion = "velox.asset-transport-recovery-summary/v1" as const;
export const recoverySuite = "asset-transport-recovery-boundary" as const;
export const recoveryDelays = [0, 1000, 2000, 4000, 6000, 7000] as const;
export const recoveryScenarios = [
  "velox-same-profile",
  "velox-fresh-profile",
  "file-url-same-profile",
  "file-url-fresh-profile",
  "virtual-host-same-profile",
  "virtual-host-fresh-profile",
  "virtual-host-fresh-origin",
] as const;

export type RecoveryDelay = typeof recoveryDelays[number];
export type RecoveryScenario = typeof recoveryScenarios[number];
export type RecoveryFramework = "velox" | "fork-file-url" | "fork-virtual-host";
export type RecoveryStatistics = { minMs: number; p50Ms: number; p95Ms: number; maxMs: number };
export type Timeline = {
  schemaVersion: "velox.host-startup-timeline/v1" | "velox.host-shutdown-timeline/v1";
  clock: "time-since-host-entry-monotonic" | "time-since-shutdown-request-monotonic";
  phases: Array<{ name: string; elapsedMs: number }>;
};
export type DiagnosticLaunch = {
  readyMs: number;
  hostExitMs: number;
  hostProcessId: number;
  browserProcessId: number;
  browserExitAfterHostExitMs: number | null;
  startupTimeline: Timeline;
  shutdownTimeline: Timeline;
};
export type RecoveryResult = {
  schemaVersion: typeof recoverySchemaVersion;
  suite: typeof recoverySuite;
  framework: RecoveryFramework;
  frameworkRevision: string;
  profileControl: "explicit-udf";
  sample: number;
  scenario: RecoveryScenario;
  requestedDelayMs: RecoveryDelay;
  outcome: "success" | "failure" | "timeout";
  startedAtUtc: string;
  finishedAtUtc: string;
  environment: {
    os: "windows";
    architecture: "amd64";
    runnerImage: string;
    runnerImageVersion: string;
    webView2Version: string;
    repositoryCommit: string;
    runId: string;
    runAttempt: string;
  };
  measurement: null | {
    readyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames";
    actualProcessStartAfterFirstHostExitMs: number;
    browserExitObservationTimeoutMs: 15000;
    firstBrowserRunningAtRelaunchStart: boolean;
    browserProcessSharedAcrossPair: boolean;
    first: DiagnosticLaunch;
    relaunched: DiagnosticLaunch;
  };
  failure: null | { phase: string; code: string };
};

type RecoveryCell = {
  requestedDelayMs: RecoveryDelay;
  observed: number;
  successful: number;
  failed: number;
  timedOut: number;
  pairedDelaySamples: number;
  pairedDelayRate: number | null;
  firstBrowserRunningAtRelaunchSamples: number;
  sharedBrowserProcessSamples: number;
  firstBrowserExitObservedSamples: number;
  relaunchedBrowserExitObservedSamples: number;
  firstReady: RecoveryStatistics | null;
  relaunchedReady: RecoveryStatistics | null;
  relaunchedMinusFirst: RecoveryStatistics | null;
  actualStartGap: RecoveryStatistics | null;
  firstEnvironmentCreate: RecoveryStatistics | null;
  relaunchedEnvironmentCreate: RecoveryStatistics | null;
  firstControllerCreate: RecoveryStatistics | null;
  relaunchedControllerCreate: RecoveryStatistics | null;
  firstPostController: RecoveryStatistics | null;
  relaunchedPostController: RecoveryStatistics | null;
  firstBrowserExitAfterHostExit: RecoveryStatistics | null;
  relaunchedBrowserExitAfterHostExit: RecoveryStatistics | null;
  relaunchedReadyAfterFirstBrowserExit: RecoveryStatistics | null;
  dominantRelaunchPhase: "environment-create" | "controller-create" | "post-controller" | null;
};

export type RecoverySummary = {
  schemaVersion: typeof recoverySummarySchemaVersion;
  suite: typeof recoverySuite;
  expectedPerCell: 1 | 3 | 10;
  observed: number;
  publishable: boolean;
  environmentCount: number;
  experimentClassification: "recovery-boundary-observed" | "no-delay-observed" | "not-recovered-within-range" | "insufficient-evidence";
  rows: Array<{
    scenario: RecoveryScenario;
    framework: RecoveryFramework;
    revision: string;
    recoveryClassification: "recovers-within-range" | "no-delay-observed" | "not-recovered-within-range" | "insufficient-evidence";
    maximumDelayWithTailMs: RecoveryDelay | null;
    cleanFromDelayMs: RecoveryDelay | null;
    cells: RecoveryCell[];
  }>;
};

const scenarioFramework: Record<RecoveryScenario, RecoveryFramework> = {
  "velox-same-profile": "velox",
  "velox-fresh-profile": "velox",
  "file-url-same-profile": "fork-file-url",
  "file-url-fresh-profile": "fork-file-url",
  "virtual-host-same-profile": "fork-virtual-host",
  "virtual-host-fresh-profile": "fork-virtual-host",
  "virtual-host-fresh-origin": "fork-virtual-host",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function validateTimeline(timeline: Timeline | undefined, schemaVersion: Timeline["schemaVersion"], clock: Timeline["clock"]): void {
  if (!timeline || timeline.schemaVersion !== schemaVersion || timeline.clock !== clock || !Array.isArray(timeline.phases) || timeline.phases.length === 0) {
    throw new Error(`invalid ${schemaVersion} timeline`);
  }
  let previous = -1;
  for (const phase of timeline.phases) {
    if (!phase.name || !finiteNonNegative(phase.elapsedMs) || phase.elapsedMs < previous) throw new Error(`invalid ${schemaVersion} phase order`);
    previous = phase.elapsedMs;
  }
}

function validateLaunch(launch: DiagnosticLaunch | undefined): void {
  if (!launch || !finiteNonNegative(launch.readyMs) || !finiteNonNegative(launch.hostExitMs) ||
      !Number.isInteger(launch.hostProcessId) || launch.hostProcessId <= 0 ||
      !Number.isInteger(launch.browserProcessId) || launch.browserProcessId <= 0 ||
      (launch.browserExitAfterHostExitMs !== null && !finite(launch.browserExitAfterHostExitMs))) {
    throw new Error("invalid diagnostic launch");
  }
  validateTimeline(launch.startupTimeline, "velox.host-startup-timeline/v1", "time-since-host-entry-monotonic");
  validateTimeline(launch.shutdownTimeline, "velox.host-shutdown-timeline/v1", "time-since-shutdown-request-monotonic");
  const required = ["environment-create-started", "environment-created", "controller-created", "navigation-dispatched", "dom-2raf"];
  let cursor = -1;
  for (const name of required) {
    const index = launch.startupTimeline.phases.findIndex((phase, phaseIndex) => phaseIndex > cursor && phase.name === name);
    if (index < 0) throw new Error(`startup timeline is missing ${name}`);
    cursor = index;
  }
}

export function validateRecoveryResult(value: unknown): asserts value is RecoveryResult {
  if (!value || typeof value !== "object") throw new Error("recovery result must be an object");
  const result = value as Partial<RecoveryResult>;
  if (result.schemaVersion !== recoverySchemaVersion || result.suite !== recoverySuite ||
      !recoveryScenarios.includes(result.scenario as RecoveryScenario) ||
      scenarioFramework[result.scenario as RecoveryScenario] !== result.framework) throw new Error("unsupported recovery identity");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "") || result.profileControl !== "explicit-udf" ||
      !Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9 ||
      !recoveryDelays.includes(result.requestedDelayMs as RecoveryDelay)) throw new Error("invalid recovery identity");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid recovery outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid recovery timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.os !== "windows" || environment.architecture !== "amd64" ||
      !environment.runnerImage || !environment.runnerImageVersion || !environment.webView2Version ||
      !environment.repositoryCommit || !environment.runId || !environment.runAttempt) throw new Error("invalid recovery environment");
  if (result.outcome === "success") {
    const measurement = result.measurement;
    if (!measurement || result.failure !== null || measurement.readyBoundary !== "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames" ||
        !finiteNonNegative(measurement.actualProcessStartAfterFirstHostExitMs) || measurement.actualProcessStartAfterFirstHostExitMs < result.requestedDelayMs! ||
        measurement.browserExitObservationTimeoutMs !== 15000 ||
        typeof measurement.firstBrowserRunningAtRelaunchStart !== "boolean" ||
        typeof measurement.browserProcessSharedAcrossPair !== "boolean") throw new Error("successful recovery result is incomplete");
    validateLaunch(measurement.first);
    validateLaunch(measurement.relaunched);
    if (measurement.browserProcessSharedAcrossPair !== (measurement.first.browserProcessId === measurement.relaunched.browserProcessId)) {
      throw new Error("browser process sharing flag does not match process IDs");
    }
    if (result.scenario.endsWith("fresh-profile") && measurement.browserProcessSharedAcrossPair) {
      throw new Error("fresh-profile recovery reused the first browser process");
    }
    if (measurement.firstBrowserRunningAtRelaunchStart === true && measurement.first.browserExitAfterHostExitMs !== null &&
        measurement.first.browserExitAfterHostExitMs < measurement.actualProcessStartAfterFirstHostExitMs) {
      throw new Error("first browser exit precedes a running-at-relaunch observation");
    }
  } else if (result.measurement !== null || !result.failure?.phase || !/^[A-Z0-9_]+$/.test(result.failure.code ?? "")) {
    throw new Error("failed recovery result is incomplete");
  }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function statistics(values: number[]): RecoveryStatistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return { minMs: sorted[0], p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxMs: sorted[sorted.length - 1] };
}

function phaseElapsed(timeline: Timeline, name: string): number {
  const phase = timeline.phases.find((candidate) => candidate.name === name);
  if (!phase) throw new Error(`timeline phase ${name} is missing`);
  return phase.elapsedMs;
}

function phaseInterval(timeline: Timeline, start: string, end: string): number {
  return phaseElapsed(timeline, end) - phaseElapsed(timeline, start);
}

function dominantRelaunchPhase(
  environment: RecoveryStatistics | null,
  controller: RecoveryStatistics | null,
  postController: RecoveryStatistics | null,
): RecoveryCell["dominantRelaunchPhase"] {
  if (!environment || !controller || !postController) return null;
  return [
    { phase: "environment-create" as const, duration: environment.p50Ms },
    { phase: "controller-create" as const, duration: controller.p50Ms },
    { phase: "post-controller" as const, duration: postController.p50Ms },
  ].sort((left, right) => right.duration - left.duration)[0].phase;
}

function environmentKey(result: RecoveryResult): string {
  const environment = result.environment;
  return [environment.runnerImage, environment.runnerImageVersion, environment.webView2Version, environment.repositoryCommit, result.frameworkRevision].join("|");
}

function isPairedDelay(result: RecoveryResult): boolean {
  if (result.outcome !== "success") return false;
  const first = result.measurement!.first.readyMs;
  const relaunched = result.measurement!.relaunched.readyMs;
  return relaunched >= first * 2 && relaunched - first >= 1000;
}

export function buildRecoverySummary(results: RecoveryResult[], expected: 1 | 3 | 10): RecoverySummary {
  const seen = new Set<string>();
  for (const result of results) {
    validateRecoveryResult(result);
    const key = `${result.scenario}:${result.sample}:${result.requestedDelayMs}`;
    if (seen.has(key)) throw new Error(`duplicate recovery result ${key}`);
    seen.add(key);
  }
  const environmentCount = new Set(results.map(environmentKey)).size;
  const rows = recoveryScenarios.map((scenario) => {
    const scenarioResults = results.filter((result) => result.scenario === scenario);
    const revisions = new Set(scenarioResults.map((result) => result.frameworkRevision));
    if (revisions.size > 1) throw new Error(`${scenario} revisions are inconsistent`);
    const cells = recoveryDelays.map((requestedDelayMs): RecoveryCell => {
      const cell = scenarioResults.filter((result) => result.requestedDelayMs === requestedDelayMs);
      const successful = cell.filter((result) => result.outcome === "success");
      const measurements = successful.map((result) => result.measurement!);
      const firstBrowserExit = measurements.map((measurement) => measurement.first.browserExitAfterHostExitMs).filter(finite);
      const relaunchedBrowserExit = measurements.map((measurement) => measurement.relaunched.browserExitAfterHostExitMs).filter(finite);
      const firstEnvironmentCreate = statistics(measurements.map((measurement) => phaseInterval(measurement.first.startupTimeline, "environment-create-started", "environment-created")));
      const relaunchedEnvironmentCreate = statistics(measurements.map((measurement) => phaseInterval(measurement.relaunched.startupTimeline, "environment-create-started", "environment-created")));
      const firstControllerCreate = statistics(measurements.map((measurement) => phaseInterval(measurement.first.startupTimeline, "environment-created", "controller-created")));
      const relaunchedControllerCreate = statistics(measurements.map((measurement) => phaseInterval(measurement.relaunched.startupTimeline, "environment-created", "controller-created")));
      const firstPostController = statistics(measurements.map((measurement) => phaseInterval(measurement.first.startupTimeline, "controller-created", "dom-2raf")));
      const relaunchedPostController = statistics(measurements.map((measurement) => phaseInterval(measurement.relaunched.startupTimeline, "controller-created", "dom-2raf")));
      return {
        requestedDelayMs,
        observed: cell.length,
        successful: successful.length,
        failed: cell.filter((result) => result.outcome === "failure").length,
        timedOut: cell.filter((result) => result.outcome === "timeout").length,
        pairedDelaySamples: successful.filter(isPairedDelay).length,
        pairedDelayRate: successful.length === 0 ? null : successful.filter(isPairedDelay).length / successful.length,
        firstBrowserRunningAtRelaunchSamples: measurements.filter((measurement) => measurement.firstBrowserRunningAtRelaunchStart === true).length,
        sharedBrowserProcessSamples: measurements.filter((measurement) => measurement.browserProcessSharedAcrossPair).length,
        firstBrowserExitObservedSamples: firstBrowserExit.length,
        relaunchedBrowserExitObservedSamples: relaunchedBrowserExit.length,
        firstReady: statistics(measurements.map((measurement) => measurement.first.readyMs)),
        relaunchedReady: statistics(measurements.map((measurement) => measurement.relaunched.readyMs)),
        relaunchedMinusFirst: statistics(measurements.map((measurement) => measurement.relaunched.readyMs - measurement.first.readyMs)),
        actualStartGap: statistics(measurements.map((measurement) => measurement.actualProcessStartAfterFirstHostExitMs)),
        firstEnvironmentCreate,
        relaunchedEnvironmentCreate,
        firstControllerCreate,
        relaunchedControllerCreate,
        firstPostController,
        relaunchedPostController,
        firstBrowserExitAfterHostExit: statistics(firstBrowserExit),
        relaunchedBrowserExitAfterHostExit: statistics(relaunchedBrowserExit),
        relaunchedReadyAfterFirstBrowserExit: statistics(measurements.flatMap((measurement) => {
          const browserExit = measurement.first.browserExitAfterHostExitMs;
          return browserExit === null ? [] : [measurement.actualProcessStartAfterFirstHostExitMs + measurement.relaunched.readyMs - browserExit];
        })),
        dominantRelaunchPhase: dominantRelaunchPhase(relaunchedEnvironmentCreate, relaunchedControllerCreate, relaunchedPostController),
      };
    });
    const complete = cells.every((cell) => cell.successful === expected);
    const tailDelays = cells.filter((cell) => cell.pairedDelaySamples > 0).map((cell) => cell.requestedDelayMs);
    let recoveryClassification: RecoverySummary["rows"][number]["recoveryClassification"] = "insufficient-evidence";
    let cleanFromDelayMs: RecoveryDelay | null = null;
    if (complete) {
      if (tailDelays.length === 0) {
        recoveryClassification = "no-delay-observed";
        cleanFromDelayMs = 0;
      } else {
        cleanFromDelayMs = recoveryDelays.find((_, index) => index > 0 && cells.slice(index).every((cell) => cell.pairedDelaySamples === 0)) ?? null;
        recoveryClassification = cleanFromDelayMs === null ? "not-recovered-within-range" : "recovers-within-range";
      }
    }
    return {
      scenario, framework: scenarioFramework[scenario], revision: [...revisions][0] ?? "unavailable", recoveryClassification,
      maximumDelayWithTailMs: tailDelays.length === 0 ? null : Math.max(...tailDelays) as RecoveryDelay,
      cleanFromDelayMs, cells,
    };
  });
  const complete = rows.every((row) => row.cells.every((cell) => cell.successful === expected));
  let experimentClassification: RecoverySummary["experimentClassification"] = "insufficient-evidence";
  if (complete && environmentCount === 1) {
    if (rows.every((row) => row.recoveryClassification === "no-delay-observed")) experimentClassification = "no-delay-observed";
    else if (rows.some((row) => row.recoveryClassification === "not-recovered-within-range")) experimentClassification = "not-recovered-within-range";
    else experimentClassification = "recovery-boundary-observed";
  }
  return {
    schemaVersion: recoverySummarySchemaVersion, suite: recoverySuite, expectedPerCell: expected,
    observed: results.length, publishable: expected === 10 && complete && environmentCount === 1,
    environmentCount, experimentClassification, rows,
  };
}
