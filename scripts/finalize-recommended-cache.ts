import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cachePolicies, recommendedCacheSchemaVersion, validateRecommendedCacheResult, type RecommendedCacheDraft, type RecommendedCacheResult } from "./recommended-cache-contracts";
import type { CacheRecord } from "./cache-api";

const [draftArgument, resultArgument, cacheKey, restoreTimingArgument, saveTimingArgument, metadataArgument] = process.argv.slice(2);
if (!draftArgument || !resultArgument || cacheKey === undefined || !restoreTimingArgument || !saveTimingArgument || !metadataArgument) {
  throw new Error("usage: finalize-recommended-cache.ts <draft> <result> <cache-key-or-none> <restore-timing-or-none> <save-timing-or-none> <metadata-or-none>");
}

async function optionalJSON<T>(path: string): Promise<T | null> {
  return path === "none" ? null : JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

const draft = JSON.parse(await readFile(resolve(draftArgument), "utf8")) as RecommendedCacheDraft;
if (draft.schemaVersion !== "actutum.recommended-cache-draft/v1" || draft.suite !== "recommended-cache") throw new Error("invalid recommended-cache draft");
const restoreTiming = await optionalJSON<{ durationMs: number }>(restoreTimingArgument);
const saveTiming = await optionalJSON<{ durationMs: number }>(saveTimingArgument);
const metadata = await optionalJSON<CacheRecord>(metadataArgument);
const policy = cachePolicies[draft.framework];
const cacheFree = draft.framework === "actutum";
const hitValue = process.env.ACTUTUM_CACHE_HIT;
const restoreHit = cacheFree ? null : hitValue === "true" ? true : hitValue === "false" ? false : null;
const archiveBytes = metadata?.sizeBytes ?? 0;

const result: RecommendedCacheResult = {
  ...draft,
  schemaVersion: recommendedCacheSchemaVersion,
  cache: {
    policy: policy.id,
    paths: [...policy.paths],
    key: cacheFree ? null : cacheKey,
    restoreHit,
    restoreMs: restoreTiming?.durationMs ?? 0,
    saveMs: saveTiming?.durationMs ?? 0,
    archiveBytes,
    uploadedCacheBytes: draft.phase === "prime" ? archiveBytes : 0,
    restoredCacheBytes: draft.phase === "warm" ? archiveBytes : 0,
    evidence: cacheFree ? "not-applicable" : metadata ? "github-actions-api" : "workflow-action-output",
  },
};
validateRecommendedCacheResult(result);
await mkdir(dirname(resolve(resultArgument)), { recursive: true });
await Bun.write(resolve(resultArgument), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ framework: result.framework, phase: result.phase, outcome: result.outcome, cache: result.cache }));
if (result.outcome !== "success") process.exit(1);
