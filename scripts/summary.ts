import { frameworks, percentile, validateResult, type Framework, type Result } from "./contracts";
import { comparableEnvironment, environmentKey, type ComparableEnvironmentIdentity } from "./environment";

export type BenchmarkSummary = {
  schemaVersion: "velox.bench-summary/v2";
  suite: "zero-cache";
  expectedPerFramework: number;
  fixtureSha256: string;
  frameworkRevisions: Record<Framework, string>;
  uploadedCacheBytes: 0;
  environmentCount: number;
  environments: Array<ComparableEnvironmentIdentity & { bunVersion: string; observed: number }>;
  hardwareBalanced: boolean;
  hardwareVariants: Array<{
    cpuModel: string;
    observed: number;
    frameworks: Record<Framework, number>;
  }>;
  publishable: boolean;
  rows: Array<{
    framework: Framework;
    expected: number;
    observed: number;
    missing: number;
    successful: number;
    failed: number;
    timedOut: number;
    endToEndMs: null | { min: number; p50: number; p95: number; max: number };
  }>;
};

export function validateSummary(value: unknown): asserts value is BenchmarkSummary {
  if (!value || typeof value !== "object") throw new Error("summary must be an object");
  const summary = value as Partial<BenchmarkSummary>;
  if (summary.schemaVersion !== "velox.bench-summary/v2" || summary.suite !== "zero-cache") throw new Error("unsupported summary contract");
  if (![1, 3, 10].includes(summary.expectedPerFramework ?? 0)) throw new Error("invalid summary sample count");
  if (summary.uploadedCacheBytes !== 0) throw new Error("summary cache evidence is invalid");
  if (!Array.isArray(summary.environments) || summary.environments.length < 1 || summary.environmentCount !== summary.environments.length) {
    throw new Error("summary environment groups are invalid");
  }
  if (!Array.isArray(summary.hardwareVariants) || summary.hardwareVariants.length < 1 || typeof summary.hardwareBalanced !== "boolean") {
    throw new Error("summary hardware groups are invalid");
  }
  if (!Array.isArray(summary.rows) || summary.rows.length !== frameworks.length) throw new Error("summary rows are invalid");
  for (const framework of frameworks) {
    const rows = summary.rows.filter((row) => row.framework === framework);
    if (rows.length !== 1) throw new Error(`summary must contain exactly one ${framework} row`);
  }
}

export function buildSummary(results: Result[], expectedPerFramework: number): BenchmarkSummary {
  if (results.length === 0) throw new Error("no raw benchmark results were found");
  if (![1, 3, 10].includes(expectedPerFramework)) throw new Error("expected sample count must be 1, 3, or 10");
  const keys = new Set<string>();
  const fixtureDigests = new Set<string>();
  const revisions = {} as Record<Framework, string>;
  for (const result of results) {
    validateResult(result);
    const key = `${result.framework}:${result.sample}`;
    if (keys.has(key)) throw new Error(`duplicate sample ${key}`);
    keys.add(key);
    fixtureDigests.add(result.fixtureSha256);
    const previous = revisions[result.framework];
    if (previous && previous !== result.frameworkRevision) throw new Error(`mixed revisions for ${result.framework}`);
    revisions[result.framework] = result.frameworkRevision;
  }
  if (fixtureDigests.size !== 1) throw new Error("mixed fixture digests");
  for (const framework of frameworks) {
    if (!revisions[framework]) throw new Error(`missing raw result for ${framework}`);
  }

  const rows = frameworks.map((framework) => {
    const samples = results.filter((result) => result.framework === framework);
    const successes = samples.filter((result) => result.outcome === "success" && result.measurement);
    const durations = successes.map((result) => result.measurement!.endToEndMs);
    return {
      framework,
      expected: expectedPerFramework,
      observed: samples.length,
      missing: Math.max(0, expectedPerFramework - samples.length),
      successful: successes.length,
      failed: samples.filter((result) => result.outcome === "failure").length,
      timedOut: samples.filter((result) => result.outcome === "timeout").length,
      endToEndMs: durations.length === 0 ? null : {
        min: Math.min(...durations),
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: Math.max(...durations),
      },
    };
  });
  const completeSampleSet = expectedPerFramework === 10 && rows.every((row) => {
    const ids = results.filter((result) => result.framework === row.framework).map((result) => result.sample).sort((a, b) => a - b);
    return JSON.stringify(ids) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  const environmentGroups = new Map<string, BenchmarkSummary["environments"][number]>();
  const hardwareGroups = new Map<string, BenchmarkSummary["hardwareVariants"][number]>();
  for (const result of results) {
    const identity = comparableEnvironment({
      runner: result.environment.runner,
      runnerImageVersion: result.environment.runnerImageVersion,
      os: result.environment.os,
      architecture: result.environment.architecture,
      windowsVersion: result.environment.windowsVersion,
      cpuModel: result.environment.cpuModel,
      logicalProcessors: result.environment.logicalProcessors,
      memoryBytes: result.environment.memoryBytes,
    });
    const key = environmentKey(identity);
    const existing = environmentGroups.get(key);
    if (existing) existing.observed += 1;
    else environmentGroups.set(key, { ...identity, bunVersion: result.environment.bunVersion, observed: 1 });
    const cpuModel = result.environment.cpuModel.trim().replace(/\s+/g, " ");
    const hardware = hardwareGroups.get(cpuModel) ?? {
      cpuModel,
      observed: 0,
      frameworks: { velox: 0, wails: 0, neutralino: 0, tauri: 0 },
    };
    hardware.observed += 1;
    hardware.frameworks[result.framework] += 1;
    hardwareGroups.set(cpuModel, hardware);
  }
  const environments = [...environmentGroups.values()].sort((left, right) =>
    environmentKey(left).localeCompare(environmentKey(right)),
  );
  const hardwareVariants = [...hardwareGroups.values()].sort((left, right) => left.cpuModel.localeCompare(right.cpuModel));
  const hardwareBalanced = hardwareVariants.every((variant) => {
    const counts = frameworks.map((framework) => variant.frameworks[framework]);
    return Math.max(...counts) - Math.min(...counts) <= 1;
  });
  const summary: BenchmarkSummary = {
    schemaVersion: "velox.bench-summary/v2",
    suite: "zero-cache" as const,
    expectedPerFramework,
    fixtureSha256: [...fixtureDigests][0],
    frameworkRevisions: revisions,
    uploadedCacheBytes: 0,
    environmentCount: environments.length,
    environments,
    hardwareBalanced,
    hardwareVariants,
    publishable: completeSampleSet && environments.length === 1 && hardwareBalanced && rows.every((row) => row.successful === expectedPerFramework),
    rows,
  };
  validateSummary(summary);
  return summary;
}
