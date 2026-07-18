import type { Result } from "./contracts";
import type { ComparableEnvironmentIdentity } from "./environment";
import { buildScopedSummary, type SummaryRow } from "./summary-core";

export const pairFrameworks = ["actutum", "wails"] as const;
export type PairFramework = (typeof pairFrameworks)[number];

export type PairSummary = {
  schemaVersion: "actutum.bench-pair-summary/v2";
  suite: "zero-cache";
  scope: "actutum-wails";
  expectedPerFramework: number;
  fixtureSha256: string;
  frameworkRevisions: Record<PairFramework, string>;
  uploadedCacheBytes: 0;
  environmentCount: number;
  environments: Array<ComparableEnvironmentIdentity & { bunVersion: string; observed: number }>;
  hardwareBalanced: boolean;
  hardwareVariants: Array<{
    cpuModel: string;
    observed: number;
    frameworks: Record<PairFramework, number>;
  }>;
  publishable: boolean;
  rows: Array<SummaryRow & { framework: PairFramework }>;
};

export function validatePairSummary(value: unknown): asserts value is PairSummary {
  if (!value || typeof value !== "object") throw new Error("pair summary must be an object");
  const summary = value as Partial<PairSummary>;
  if (summary.schemaVersion !== "actutum.bench-pair-summary/v2" || summary.suite !== "zero-cache" || summary.scope !== "actutum-wails") {
    throw new Error("unsupported pair summary contract");
  }
  if (![1, 3, 10].includes(summary.expectedPerFramework ?? 0)) throw new Error("invalid pair summary sample count");
  if (summary.uploadedCacheBytes !== 0) throw new Error("pair summary cache evidence is invalid");
  if (!Array.isArray(summary.environments) || summary.environments.length < 1 || summary.environmentCount !== summary.environments.length) {
    throw new Error("pair summary environment groups are invalid");
  }
  if (!Array.isArray(summary.hardwareVariants) || summary.hardwareVariants.length < 1 || typeof summary.hardwareBalanced !== "boolean") {
    throw new Error("pair summary hardware groups are invalid");
  }
  if (!Array.isArray(summary.rows) || summary.rows.length !== pairFrameworks.length) throw new Error("pair summary rows are invalid");
  for (const framework of pairFrameworks) {
    if (summary.rows.filter((row) => row.framework === framework).length !== 1) {
      throw new Error(`pair summary must contain exactly one ${framework} row`);
    }
  }
}

export function buildPairSummary(results: Result[], expectedPerFramework: number): PairSummary {
  if (results.some((result) => result.fixture.name !== "hello")) {
    throw new Error("Actutum-Wails pair publication accepts only the hello fixture");
  }
  for (let sample = 0; sample < expectedPerFramework; sample += 1) {
    const actutum = results.find((result) => result.framework === "actutum" && result.sample === sample);
    const wails = results.find((result) => result.framework === "wails" && result.sample === sample);
    if (!actutum || !wails) continue;
    const sameRunner =
      actutum.environment.runner === wails.environment.runner &&
      actutum.environment.runnerImageVersion === wails.environment.runnerImageVersion &&
      actutum.environment.windowsVersion === wails.environment.windowsVersion &&
      actutum.environment.cpuModel === wails.environment.cpuModel &&
      actutum.environment.logicalProcessors === wails.environment.logicalProcessors &&
      actutum.environment.memoryBytes === wails.environment.memoryBytes;
    if (!sameRunner) throw new Error(`pair sample ${sample} does not share exact runner hardware`);
    const actutumStart = Date.parse(actutum.startedAtUtc);
    const actutumFinish = Date.parse(actutum.finishedAtUtc);
    const wailsStart = Date.parse(wails.startedAtUtc);
    const wailsFinish = Date.parse(wails.finishedAtUtc);
    if (!(actutumFinish <= wailsStart || wailsFinish <= actutumStart)) {
      throw new Error(`pair sample ${sample} execution intervals overlap`);
    }
  }
  const core = buildScopedSummary(results, expectedPerFramework, pairFrameworks, "actutum-wails");
  const summary: PairSummary = {
    schemaVersion: "actutum.bench-pair-summary/v2",
    suite: "zero-cache",
    scope: "actutum-wails",
    expectedPerFramework,
    fixtureSha256: core.fixture.sha256,
    frameworkRevisions: core.frameworkRevisions as Record<PairFramework, string>,
    uploadedCacheBytes: core.uploadedCacheBytes,
    environmentCount: core.environmentCount,
    environments: core.environments,
    hardwareBalanced: core.hardwareBalanced,
    hardwareVariants: core.hardwareVariants.map((variant) => ({
      ...variant,
      frameworks: variant.frameworks as Record<PairFramework, number>,
    })),
    publishable: core.publishable,
    rows: core.rows as Array<SummaryRow & { framework: PairFramework }>,
  };
  validatePairSummary(summary);
  return summary;
}
