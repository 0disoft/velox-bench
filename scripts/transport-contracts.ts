export const transportSchemaVersion = "actutum.asset-transport-relaunch/v2" as const;
export const transportSummarySchemaVersion = "actutum.asset-transport-relaunch-summary/v2" as const;
export const transportSuite = "asset-transport-immediate-relaunch" as const;
export const transports = ["actutum", "fork-file-url", "fork-virtual-host", "fork-web-resource"] as const;

export type Transport = typeof transports[number];
export type Statistics = { minMs: number; p50Ms: number; p95Ms: number; maxMs: number };

export type TransportResult = {
  schemaVersion: typeof transportSchemaVersion;
  suite: typeof transportSuite;
  framework: Transport;
  frameworkRevision: string;
  profileControl: "explicit-udf";
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

export type TransportSummary = {
  schemaVersion: typeof transportSummarySchemaVersion;
  suite: typeof transportSuite;
  expectedPerTransport: 1 | 3 | 10;
  observed: number;
  publishable: boolean;
  transportClassification: "virtual-host-mapping-delay" | "actutum-only-delay" | "virtual-host-control-delay" | "web-resource-delay" | "shared-delay" | "not-observed" | "insufficient-evidence" | "mixed-delay";
  rows: Array<{
    transport: Transport;
    revision: string;
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

export function validateTransportResult(value: unknown): asserts value is TransportResult {
  if (!value || typeof value !== "object") throw new Error("transport result must be an object");
  const result = value as Partial<TransportResult>;
  if (result.schemaVersion !== transportSchemaVersion || result.suite !== transportSuite ||
      !transports.includes(result.framework as Transport)) throw new Error("unsupported transport result contract");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "") || result.profileControl !== "explicit-udf" ||
      !Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9) throw new Error("invalid transport identity");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid transport outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid transport timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.os !== "windows" || environment.architecture !== "amd64" ||
      !environment.runnerImage || !environment.runnerImageVersion || !environment.webView2Version ||
      !environment.repositoryCommit || !environment.runId || !environment.runAttempt) throw new Error("invalid transport environment");
  if (result.outcome === "success") {
    const measurement = result.measurement;
    if (!measurement || result.failure !== null || measurement.readyBoundary !== "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames" ||
        !finiteNonNegative(measurement.immediateProcessStartAfterFirstHostExitMs) ||
        !finiteNonNegative(measurement.first?.readyMs) || !finiteNonNegative(measurement.first?.hostExitMs) ||
        !finiteNonNegative(measurement.immediate?.readyMs) || !finiteNonNegative(measurement.immediate?.hostExitMs)) {
      throw new Error("successful transport result is incomplete");
    }
  } else if (result.measurement !== null || !result.failure?.phase || !/^[A-Z0-9_]+$/.test(result.failure.code ?? "")) {
    throw new Error("failed transport result is incomplete");
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

export function buildTransportSummary(results: TransportResult[], expected: 1 | 3 | 10): TransportSummary {
  const rows = transports.map((transport) => {
    const transportResults = results.filter((result) => result.framework === transport);
    const seen = new Set<number>();
    for (const result of transportResults) {
      validateTransportResult(result);
      if (seen.has(result.sample)) throw new Error(`duplicate ${transport} sample ${result.sample}`);
      seen.add(result.sample);
    }
    const revisions = new Set(transportResults.map((result) => result.frameworkRevision));
    if (revisions.size > 1) throw new Error(`${transport} revisions are inconsistent`);
    const successful = transportResults.filter((result) => result.outcome === "success");
    const first = successful.map((result) => result.measurement!.first.readyMs);
    const immediate = successful.map((result) => result.measurement!.immediate.readyMs);
    const delta = successful.map((result) => result.measurement!.immediate.readyMs - result.measurement!.first.readyMs);
    const pairedDelaySamples = successful.filter((result) => {
      const firstReady = result.measurement!.first.readyMs;
      const immediateReady = result.measurement!.immediate.readyMs;
      return immediateReady >= firstReady * 2 && immediateReady - firstReady >= 1000;
    }).length;
    let delayClassification: "observed" | "not-observed" | "insufficient-evidence" = "insufficient-evidence";
    if (successful.length === expected) delayClassification = pairedDelaySamples > 0 ? "observed" : "not-observed";
    return {
      transport, revision: [...revisions][0] ?? "unavailable", observed: transportResults.length,
      successful: successful.length,
      failed: transportResults.filter((result) => result.outcome === "failure").length,
      timedOut: transportResults.filter((result) => result.outcome === "timeout").length,
      delayClassification, pairedDelaySamples,
      pairedDelayRate: successful.length === 0 ? null : pairedDelaySamples / successful.length,
      firstReady: statistics(first), immediateReady: statistics(immediate), immediateMinusFirst: statistics(delta),
    };
  });
  const complete = rows.every((row) => row.successful === expected);
  const delayed = new Set(rows.filter((row) => row.delayClassification === "observed").map((row) => row.transport));
  let classification: TransportSummary["transportClassification"] = "insufficient-evidence";
  if (complete) {
    if (delayed.size === 0) classification = "not-observed";
    else if (delayed.size === 4) classification = "shared-delay";
    else if (delayed.size === 2 && delayed.has("actutum") && delayed.has("fork-virtual-host")) classification = "virtual-host-mapping-delay";
    else if (delayed.size === 1 && delayed.has("actutum")) classification = "actutum-only-delay";
    else if (delayed.size === 1 && delayed.has("fork-virtual-host")) classification = "virtual-host-control-delay";
    else if (delayed.size === 1 && delayed.has("fork-web-resource")) classification = "web-resource-delay";
    else classification = "mixed-delay";
  }
  return {
    schemaVersion: transportSummarySchemaVersion, suite: transportSuite, expectedPerTransport: expected,
    observed: results.length, publishable: expected === 10 && complete, transportClassification: classification, rows,
  };
}
