import { percentile, validateResult, type Framework, type Result } from "./contracts";
import { comparableEnvironment, environmentKey, type ComparableEnvironmentIdentity } from "./environment";

export type SummaryRow = {
  framework: Framework;
  expected: number;
  observed: number;
  missing: number;
  successful: number;
  failed: number;
  timedOut: number;
  endToEndMs: null | { min: number; p50: number; p95: number; max: number };
};

export type SummaryEnvironment = ComparableEnvironmentIdentity & { bunVersion: string; observed: number };

export type SummaryHardwareVariant = {
  cpuModel: string;
  observed: number;
  frameworks: Partial<Record<Framework, number>>;
};

export type ScopedSummaryData = {
  fixtureSha256: string;
  frameworkRevisions: Partial<Record<Framework, string>>;
  uploadedCacheBytes: 0;
  environmentCount: number;
  environments: SummaryEnvironment[];
  hardwareBalanced: boolean;
  hardwareVariants: SummaryHardwareVariant[];
  completeSampleSet: boolean;
  publishable: boolean;
  rows: SummaryRow[];
};

export function buildScopedSummary(
  results: Result[],
  expectedPerFramework: number,
  selectedFrameworks: readonly Framework[],
  scopeName: string,
): ScopedSummaryData {
  if (results.length === 0) throw new Error("no raw benchmark results were found");
  if (![1, 3, 10].includes(expectedPerFramework)) throw new Error("expected sample count must be 1, 3, or 10");
  if (selectedFrameworks.length === 0 || new Set(selectedFrameworks).size !== selectedFrameworks.length) {
    throw new Error("summary framework scope is invalid");
  }

  const allowed = new Set<Framework>(selectedFrameworks);
  const keys = new Set<string>();
  const fixtureDigests = new Set<string>();
  const revisions: Partial<Record<Framework, string>> = {};
  for (const result of results) {
    validateResult(result);
    if (!allowed.has(result.framework)) throw new Error(`${result.framework} is outside ${scopeName} scope`);
    const key = `${result.framework}:${result.sample}`;
    if (keys.has(key)) throw new Error(`duplicate sample ${key}`);
    keys.add(key);
    fixtureDigests.add(result.fixtureSha256);
    const previous = revisions[result.framework];
    if (previous && previous !== result.frameworkRevision) throw new Error(`mixed revisions for ${result.framework}`);
    revisions[result.framework] = result.frameworkRevision;
  }
  if (fixtureDigests.size !== 1) throw new Error("mixed fixture digests");
  for (const framework of selectedFrameworks) {
    if (!revisions[framework]) throw new Error(`missing raw result for ${framework}`);
  }

  const rows = selectedFrameworks.map((framework): SummaryRow => {
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

  const expectedSampleIds = Array.from({ length: expectedPerFramework }, (_, sample) => sample);
  const completeSampleSet = expectedPerFramework === 10 && rows.every((row) => {
    const ids = results.filter((result) => result.framework === row.framework).map((result) => result.sample).sort((a, b) => a - b);
    return JSON.stringify(ids) === JSON.stringify(expectedSampleIds);
  });

  const environmentGroups = new Map<string, SummaryEnvironment>();
  const hardwareGroups = new Map<string, SummaryHardwareVariant>();
  for (const result of results) {
    const identity = comparableEnvironment(result.environment);
    const key = environmentKey(identity);
    const existingEnvironment = environmentGroups.get(key);
    if (existingEnvironment) existingEnvironment.observed += 1;
    else environmentGroups.set(key, { ...identity, bunVersion: result.environment.bunVersion, observed: 1 });

    const cpuModel = result.environment.cpuModel.trim().replace(/\s+/g, " ");
    const hardware = hardwareGroups.get(cpuModel) ?? {
      cpuModel,
      observed: 0,
      frameworks: Object.fromEntries(selectedFrameworks.map((framework) => [framework, 0])),
    };
    hardware.observed += 1;
    hardware.frameworks[result.framework] = (hardware.frameworks[result.framework] ?? 0) + 1;
    hardwareGroups.set(cpuModel, hardware);
  }

  const environments = [...environmentGroups.values()].sort((left, right) => environmentKey(left).localeCompare(environmentKey(right)));
  const hardwareVariants = [...hardwareGroups.values()].sort((left, right) => left.cpuModel.localeCompare(right.cpuModel));
  const hardwareBalanced = hardwareVariants.every((variant) => {
    const counts = selectedFrameworks.map((framework) => variant.frameworks[framework] ?? 0);
    return Math.max(...counts) - Math.min(...counts) <= 1;
  });
  const publishable = completeSampleSet && environments.length === 1 && hardwareBalanced && rows.every((row) => row.successful === expectedPerFramework);

  return {
    fixtureSha256: [...fixtureDigests][0],
    frameworkRevisions: revisions,
    uploadedCacheBytes: 0,
    environmentCount: environments.length,
    environments,
    hardwareBalanced,
    hardwareVariants,
    completeSampleSet,
    publishable,
    rows,
  };
}
