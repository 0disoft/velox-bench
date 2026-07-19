import { frameworks, validateFixtureIdentity, type FixtureIdentity, type Framework, type Result } from "./contracts";
import type { ComparableEnvironmentIdentity } from "./environment";
import { buildScopedSummary } from "./summary-core";

export type BenchmarkSummary = {
  schemaVersion: "velox.bench-summary/v3";
  suite: "zero-cache";
  expectedPerFramework: number;
  fixture: FixtureIdentity;
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
  if (summary.schemaVersion !== "velox.bench-summary/v3" || summary.suite !== "zero-cache") throw new Error("unsupported summary contract");
  if (![1, 3, 10].includes(summary.expectedPerFramework ?? 0)) throw new Error("invalid summary sample count");
  validateFixtureIdentity(summary.fixture);
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
  const core = buildScopedSummary(results, expectedPerFramework, frameworks, "all-framework");
  const summary: BenchmarkSummary = {
    schemaVersion: "velox.bench-summary/v3",
    suite: "zero-cache" as const,
    expectedPerFramework,
    fixture: core.fixture,
    frameworkRevisions: core.frameworkRevisions as Record<Framework, string>,
    uploadedCacheBytes: core.uploadedCacheBytes,
    environmentCount: core.environmentCount,
    environments: core.environments,
    hardwareBalanced: core.hardwareBalanced,
    hardwareVariants: core.hardwareVariants.map((variant) => ({
      ...variant,
      frameworks: variant.frameworks as Record<Framework, number>,
    })),
    publishable: core.publishable,
    rows: core.rows,
  };
  validateSummary(summary);
  return summary;
}
