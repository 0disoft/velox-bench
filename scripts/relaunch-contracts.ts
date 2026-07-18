export const relaunchSchemaVersion = "actutum.relaunch-control/v2" as const;
export const relaunchSummarySchemaVersion = "actutum.relaunch-control-summary/v3" as const;
export const relaunchSuite = "same-profile-immediate-relaunch" as const;
export const relaunchFrameworks = ["actutum", "webview2-control", "wails", "neutralino"] as const;

export type RelaunchFramework = typeof relaunchFrameworks[number];
export type Statistics = { minMs: number; p50Ms: number; p95Ms: number; maxMs: number };

export type RelaunchResult = {
  schemaVersion: typeof relaunchSchemaVersion;
  suite: typeof relaunchSuite;
  framework: RelaunchFramework;
  frameworkRevision: string;
  profileControl: "explicit-udf" | "framework-managed-app-directory";
  sample: number;
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
    immediateProcessStartAfterFirstHostExitMs: number;
    first: { readyMs: number; hostExitMs: number };
    immediate: { readyMs: number; hostExitMs: number };
  };
  failure: null | { phase: string; code: string };
};

export type RelaunchSummary = {
  schemaVersion: typeof relaunchSummarySchemaVersion;
  suite: typeof relaunchSuite;
  expectedPerFramework: 1 | 3 | 10;
  observed: number;
  publishable: boolean;
  platformClassification: "actutum-specific-delay" | "shared-immediate-relaunch-delay" | "webview2-host-delay" | "control-specific-delay" | "mixed-or-not-observed";
  rows: Array<{
    framework: RelaunchFramework;
    revision: string;
    profileControl: string;
    observed: number;
    successful: number;
    failed: number;
    timedOut: number;
    delayClassification: "observed" | "not-observed" | "insufficient-evidence";
    pairedDelaySamples: number;
    pairedDelayRate: number | null;
    firstReady: Statistics | null;
    immediateReady: Statistics | null;
    immediateMinusFirst: Statistics | null;
  }>;
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateRelaunchResult(value: unknown): asserts value is RelaunchResult {
  if (!value || typeof value !== "object") throw new Error("relaunch result must be an object");
  const result = value as Partial<RelaunchResult>;
  if (result.schemaVersion !== relaunchSchemaVersion || result.suite !== relaunchSuite ||
      !relaunchFrameworks.includes(result.framework as RelaunchFramework)) throw new Error("unsupported relaunch result contract");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "") || !Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9) {
    throw new Error("invalid relaunch identity");
  }
  if (!result.profileControl || !["explicit-udf", "framework-managed-app-directory"].includes(result.profileControl)) throw new Error("invalid profile control");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid relaunch outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid relaunch timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.os !== "windows" || environment.architecture !== "amd64" ||
      !environment.runnerImage || !environment.runnerImageVersion || !environment.webView2Version ||
      !environment.repositoryCommit || !environment.runId || !environment.runAttempt) throw new Error("invalid relaunch environment");
  if (result.outcome === "success") {
    const measurement = result.measurement;
    if (!measurement || result.failure !== null || measurement.readyBoundary !== "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames" ||
        !finiteNonNegative(measurement.immediateProcessStartAfterFirstHostExitMs) ||
        !finiteNonNegative(measurement.first?.readyMs) || !finiteNonNegative(measurement.first?.hostExitMs) ||
        !finiteNonNegative(measurement.immediate?.readyMs) || !finiteNonNegative(measurement.immediate?.hostExitMs)) {
      throw new Error("successful relaunch result is incomplete");
    }
  } else if (result.measurement !== null || !result.failure?.phase || !/^[A-Z0-9_]+$/.test(result.failure.code ?? "")) {
    throw new Error("failed relaunch result is incomplete");
  }
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function statistics(values: number[]): Statistics | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return { minMs: sorted[0], p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxMs: sorted[sorted.length - 1] };
}

export function buildRelaunchSummary(results: RelaunchResult[], expected: 1 | 3 | 10): RelaunchSummary {
  const rows = relaunchFrameworks.map((framework) => {
    const frameworkResults = results.filter((result) => result.framework === framework);
    const seen = new Set<number>();
    for (const result of frameworkResults) {
      validateRelaunchResult(result);
      if (seen.has(result.sample)) throw new Error(`duplicate ${framework} sample ${result.sample}`);
      seen.add(result.sample);
    }
    const revisions = new Set(frameworkResults.map((result) => result.frameworkRevision));
    const profileControls = new Set(frameworkResults.map((result) => result.profileControl));
    if (revisions.size > 1 || profileControls.size > 1) throw new Error(`${framework} inputs are inconsistent`);
    const successful = frameworkResults.filter((result) => result.outcome === "success");
    const first = successful.map((result) => result.measurement!.first.readyMs);
    const immediate = successful.map((result) => result.measurement!.immediate.readyMs);
    const delta = successful.map((result) => result.measurement!.immediate.readyMs - result.measurement!.first.readyMs);
    const firstStats = statistics(first);
    const immediateStats = statistics(immediate);
    const pairedDelaySamples = successful.filter((result) => {
      const firstReady = result.measurement!.first.readyMs;
      const immediateReady = result.measurement!.immediate.readyMs;
      return immediateReady >= firstReady * 2 && immediateReady - firstReady >= 1000;
    }).length;
    let delayClassification: "observed" | "not-observed" | "insufficient-evidence" = "insufficient-evidence";
    if (successful.length === expected && firstStats && immediateStats) {
      delayClassification = pairedDelaySamples > 0 ? "observed" : "not-observed";
    }
    return {
      framework, revision: [...revisions][0] ?? "unavailable", profileControl: [...profileControls][0] ?? "unavailable",
      observed: frameworkResults.length, successful: successful.length,
      failed: frameworkResults.filter((result) => result.outcome === "failure").length,
      timedOut: frameworkResults.filter((result) => result.outcome === "timeout").length,
      delayClassification, pairedDelaySamples,
      pairedDelayRate: successful.length === 0 ? null : pairedDelaySamples / successful.length,
      firstReady: firstStats, immediateReady: immediateStats, immediateMinusFirst: statistics(delta),
    };
  });
  const delayed = new Set(rows.filter((row) => row.delayClassification === "observed").map((row) => row.framework));
  const completeCrossHostEvidence = rows.every((row) => row.successful === expected);
  let platformClassification: RelaunchSummary["platformClassification"] = "mixed-or-not-observed";
  if (completeCrossHostEvidence) {
    if (delayed.size === 4) platformClassification = "shared-immediate-relaunch-delay";
    else if (delayed.size === 1 && delayed.has("actutum")) platformClassification = "actutum-specific-delay";
    else if (delayed.has("actutum") && delayed.has("webview2-control") && delayed.has("wails") && !delayed.has("neutralino")) platformClassification = "webview2-host-delay";
    else if (delayed.size === 1 && delayed.has("webview2-control")) platformClassification = "control-specific-delay";
  }
  return {
    schemaVersion: relaunchSummarySchemaVersion, suite: relaunchSuite, expectedPerFramework: expected,
    observed: results.length, publishable: expected === 10 && rows.every((row) => row.successful === 10), platformClassification, rows,
  };
}
