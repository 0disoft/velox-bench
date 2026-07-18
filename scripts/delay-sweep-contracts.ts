export const delaySchemaVersion = "actutum.asset-transport-delay/v2" as const;
export const delaySummarySchemaVersion = "actutum.asset-transport-delay-summary/v2" as const;
export const delaySuite = "asset-transport-relaunch-delay-sweep" as const;
export const delayValues = [0, 100, 250, 500, 1000] as const;
export const delayTransports = ["actutum", "fork-file-url", "fork-virtual-host", "fork-web-resource"] as const;

export type DelayValue = typeof delayValues[number];
export type DelayTransport = typeof delayTransports[number];
export type DelayStatistics = { minMs: number; p50Ms: number; p95Ms: number; maxMs: number };

export type DelayResult = {
  schemaVersion: typeof delaySchemaVersion;
  suite: typeof delaySuite;
  framework: DelayTransport;
  frameworkRevision: string;
  profileControl: "explicit-udf";
  sample: number;
  requestedDelayMs: DelayValue;
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
    first: { readyMs: number; hostExitMs: number };
    relaunched: { readyMs: number; hostExitMs: number };
  };
  failure: null | { phase: string; code: string };
};

type DelayCell = {
  requestedDelayMs: DelayValue;
  observed: number;
  successful: number;
  failed: number;
  timedOut: number;
  pairedDelaySamples: number;
  pairedDelayRate: number | null;
  firstReady: DelayStatistics | null;
  relaunchedReady: DelayStatistics | null;
  relaunchedMinusFirst: DelayStatistics | null;
  actualStartGap: DelayStatistics | null;
};

export type DelaySummary = {
  schemaVersion: typeof delaySummarySchemaVersion;
  suite: typeof delaySuite;
  expectedPerCell: 1 | 3 | 10;
  observed: number;
  publishable: boolean;
  environmentCount: number;
  experimentClassification: "recovery-boundary-observed" | "no-delay-observed" | "not-recovered-within-range" | "insufficient-evidence";
  rows: Array<{
    transport: DelayTransport;
    revision: string;
    recoveryClassification: "recovers-within-range" | "no-delay-observed" | "not-recovered-within-range" | "insufficient-evidence";
    maximumDelayWithTailMs: DelayValue | null;
    cleanFromDelayMs: DelayValue | null;
    cells: DelayCell[];
  }>;
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateDelayResult(value: unknown): asserts value is DelayResult {
  if (!value || typeof value !== "object") throw new Error("delay result must be an object");
  const result = value as Partial<DelayResult>;
  if (result.schemaVersion !== delaySchemaVersion || result.suite !== delaySuite ||
      !delayTransports.includes(result.framework as DelayTransport)) throw new Error("unsupported delay result contract");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "") || result.profileControl !== "explicit-udf" ||
      !Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9 ||
      !delayValues.includes(result.requestedDelayMs as DelayValue)) throw new Error("invalid delay result identity");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid delay result outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid delay result timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.os !== "windows" || environment.architecture !== "amd64" ||
      !environment.runnerImage || !environment.runnerImageVersion || !environment.webView2Version ||
      !environment.repositoryCommit || !environment.runId || !environment.runAttempt) throw new Error("invalid delay result environment");
  if (result.outcome === "success") {
    const measurement = result.measurement;
    if (!measurement || result.failure !== null || measurement.readyBoundary !== "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames" ||
        !finiteNonNegative(measurement.actualProcessStartAfterFirstHostExitMs) ||
        measurement.actualProcessStartAfterFirstHostExitMs < result.requestedDelayMs! ||
        !finiteNonNegative(measurement.first?.readyMs) || !finiteNonNegative(measurement.first?.hostExitMs) ||
        !finiteNonNegative(measurement.relaunched?.readyMs) || !finiteNonNegative(measurement.relaunched?.hostExitMs)) {
      throw new Error("successful delay result is incomplete");
    }
  } else if (result.measurement !== null || !result.failure?.phase || !/^[A-Z0-9_]+$/.test(result.failure.code ?? "")) {
    throw new Error("failed delay result is incomplete");
  }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function statistics(values: number[]): DelayStatistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return { minMs: sorted[0], p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxMs: sorted[sorted.length - 1] };
}

function environmentKey(result: DelayResult): string {
  const environment = result.environment;
  return [environment.runnerImage, environment.runnerImageVersion, environment.webView2Version, environment.repositoryCommit, result.frameworkRevision].join("|");
}

function isPairedDelay(result: DelayResult): boolean {
  if (result.outcome !== "success") return false;
  const first = result.measurement!.first.readyMs;
  const relaunched = result.measurement!.relaunched.readyMs;
  return relaunched >= first * 2 && relaunched - first >= 1000;
}

export function buildDelaySummary(results: DelayResult[], expected: 1 | 3 | 10): DelaySummary {
  const seen = new Set<string>();
  for (const result of results) {
    validateDelayResult(result);
    const key = `${result.framework}:${result.sample}:${result.requestedDelayMs}`;
    if (seen.has(key)) throw new Error(`duplicate delay result ${key}`);
    seen.add(key);
  }
  const environmentCount = new Set(results.map(environmentKey)).size;
  const rows = delayTransports.map((transport) => {
    const transportResults = results.filter((result) => result.framework === transport);
    const revisions = new Set(transportResults.map((result) => result.frameworkRevision));
    if (revisions.size > 1) throw new Error(`${transport} revisions are inconsistent`);
    const cells = delayValues.map((requestedDelayMs): DelayCell => {
      const cell = transportResults.filter((result) => result.requestedDelayMs === requestedDelayMs);
      const successful = cell.filter((result) => result.outcome === "success");
      const first = successful.map((result) => result.measurement!.first.readyMs);
      const relaunched = successful.map((result) => result.measurement!.relaunched.readyMs);
      const delta = successful.map((result) => result.measurement!.relaunched.readyMs - result.measurement!.first.readyMs);
      const gaps = successful.map((result) => result.measurement!.actualProcessStartAfterFirstHostExitMs);
      const pairedDelaySamples = successful.filter(isPairedDelay).length;
      return {
        requestedDelayMs, observed: cell.length, successful: successful.length,
        failed: cell.filter((result) => result.outcome === "failure").length,
        timedOut: cell.filter((result) => result.outcome === "timeout").length,
        pairedDelaySamples, pairedDelayRate: successful.length === 0 ? null : pairedDelaySamples / successful.length,
        firstReady: statistics(first), relaunchedReady: statistics(relaunched),
        relaunchedMinusFirst: statistics(delta), actualStartGap: statistics(gaps),
      };
    });
    const complete = cells.every((cell) => cell.successful === expected);
    const tailDelays = cells.filter((cell) => cell.pairedDelaySamples > 0).map((cell) => cell.requestedDelayMs);
    let recoveryClassification: DelaySummary["rows"][number]["recoveryClassification"] = "insufficient-evidence";
    let cleanFromDelayMs: DelayValue | null = null;
    if (complete) {
      if (tailDelays.length === 0) {
        recoveryClassification = "no-delay-observed";
        cleanFromDelayMs = 0;
      } else {
        cleanFromDelayMs = delayValues.find((delay, index) => index > 0 && cells.slice(index).every((cell) => cell.pairedDelaySamples === 0)) ?? null;
        recoveryClassification = cleanFromDelayMs === null ? "not-recovered-within-range" : "recovers-within-range";
      }
    }
    return {
      transport, revision: [...revisions][0] ?? "unavailable", recoveryClassification,
      maximumDelayWithTailMs: tailDelays.length === 0 ? null : Math.max(...tailDelays) as DelayValue,
      cleanFromDelayMs, cells,
    };
  });
  const complete = rows.every((row) => row.cells.every((cell) => cell.successful === expected));
  let experimentClassification: DelaySummary["experimentClassification"] = "insufficient-evidence";
  if (complete && environmentCount === 1) {
    if (rows.every((row) => row.recoveryClassification === "no-delay-observed")) experimentClassification = "no-delay-observed";
    else if (rows.some((row) => row.recoveryClassification === "not-recovered-within-range")) experimentClassification = "not-recovered-within-range";
    else experimentClassification = "recovery-boundary-observed";
  }
  return {
    schemaVersion: delaySummarySchemaVersion, suite: delaySuite, expectedPerCell: expected,
    observed: results.length, publishable: expected === 10 && complete && environmentCount === 1,
    environmentCount, experimentClassification, rows,
  };
}
