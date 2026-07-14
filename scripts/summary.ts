import { frameworks, percentile, validateResult, type Framework, type Result } from "./contracts";

export function buildSummary(results: Result[], expectedPerFramework: number) {
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
  return {
    schemaVersion: "velox.bench-summary/v1" as const,
    suite: "zero-cache" as const,
    expectedPerFramework,
    fixtureSha256: [...fixtureDigests][0],
    frameworkRevisions: revisions,
    publishable: completeSampleSet && rows.every((row) => row.successful === expectedPerFramework),
    rows,
  };
}
