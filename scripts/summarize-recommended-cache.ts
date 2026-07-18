import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { percentile } from "./contracts";
import { cachePolicies, frameworksForScope, recommendedCacheSummarySchemaVersion, validateRecommendedCacheResult, type RecommendedCacheResult, type RecommendedCacheSummary } from "./recommended-cache-contracts";

async function readResults(root: string): Promise<RecommendedCacheResult[]> {
  const results: RecommendedCacheResult[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (value?.schemaVersion === "velox.recommended-cache-result/v1") {
          validateRecommendedCacheResult(value);
          results.push(value);
        }
      }
    }
  }
  await walk(root);
  return results;
}
export function buildRecommendedCacheSummary(results: RecommendedCacheResult[], expectedSamples: number, scope: string): RecommendedCacheSummary {
  if (!Number.isInteger(expectedSamples) || expectedSamples < 1 || expectedSamples > 3) throw new Error("expected samples must be 1 or 3");
  const expectedFrameworks = frameworksForScope(scope);
  const expectedKeys = new Set<string>();
  for (const framework of expectedFrameworks) for (let sample = 0; sample < expectedSamples; sample++) for (const phase of ["prime", "warm"]) expectedKeys.add(`${framework}:${sample}:${phase}`);
  const observed = new Map<string, RecommendedCacheResult>();
  for (const result of results) {
    if (!expectedFrameworks.includes(result.framework)) continue;
    const key = `${result.framework}:${result.sample}:${result.phase}`;
    if (!expectedKeys.has(key)) throw new Error(`unexpected result ${key}`);
    if (observed.has(key)) throw new Error(`duplicate result ${key}`);
    observed.set(key, result);
  }

  const rows = expectedFrameworks.map((framework) => {
    const prime = [...observed.values()].filter((result) => result.framework === framework && result.phase === "prime");
    const warm = [...observed.values()].filter((result) => result.framework === framework && result.phase === "warm");
    const primeSuccess = prime.filter((result) => result.outcome === "success" && result.measurement);
    const warmSuccess = warm.filter((result) => result.outcome === "success" && result.measurement);
    const failures = [...prime, ...warm].filter((result) => result.outcome !== "success").length;
    const missing = expectedSamples * 2 - prime.length - warm.length;
    const p50 = (values: number[]) => values.length ? percentile(values, 0.5) : null;
    return {
      framework,
      cachePolicy: cachePolicies[framework].id,
      successfulPrimeSamples: primeSuccess.length,
      successfulWarmSamples: warmSuccess.length,
      failureCount: failures,
      missingCount: missing,
      archiveBytesP50: p50(primeSuccess.map((result) => result.cache.archiveBytes)),
      uploadedCacheBytesTotal: primeSuccess.reduce((sum, result) => sum + result.cache.uploadedCacheBytes, 0),
      primeEndToEndP50Ms: p50(primeSuccess.map((result) => result.measurement!.endToEndMs)),
      warmEndToEndP50Ms: p50(warmSuccess.map((result) => result.measurement!.endToEndMs)),
      warmRestoreP50Ms: p50(warmSuccess.map((result) => result.cache.restoreMs)),
      warmBuildP50Ms: p50(warmSuccess.map((result) => result.measurement!.buildMs)),
    };
  });
  const evidenceComplete = rows.every((row) => row.successfulPrimeSamples === expectedSamples && row.successfulWarmSamples === expectedSamples && row.failureCount === 0 && row.missingCount === 0);
  return { schemaVersion: recommendedCacheSummarySchemaVersion, suite: "recommended-cache", expectedSamples, expectedFrameworks, evidenceComplete, comparativeClaimAllowed: false, rows };
}

if (import.meta.main) {
  const [inputArgument, outputArgument, expectedArgument, scope] = process.argv.slice(2);
  if (!inputArgument || !outputArgument || !expectedArgument || !scope) throw new Error("usage: summarize-recommended-cache.ts <input> <output> <expected-samples> <scope>");
  const results = await readResults(resolve(inputArgument));
  const summary = buildRecommendedCacheSummary(results, Number(expectedArgument), scope);
  await mkdir(dirname(resolve(outputArgument)), { recursive: true });
  await Bun.write(resolve(outputArgument), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ evidenceComplete: summary.evidenceComplete, rows: summary.rows }));
  if (!summary.evidenceComplete) process.exit(1);
}
