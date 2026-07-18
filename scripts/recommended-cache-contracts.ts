import type { FixtureIdentity, Framework, Result as ZeroCacheResult } from "./contracts";

export const recommendedCacheSchemaVersion = "actutum.recommended-cache-result/v2" as const;
export const recommendedCacheSummarySchemaVersion = "actutum.recommended-cache-summary/v2" as const;
export const recommendedCachePhases = ["prime", "warm"] as const;
export type RecommendedCachePhase = (typeof recommendedCachePhases)[number];

export const cachePolicies = {
  actutum: { id: "none", paths: [] },
  wails: { id: "go-module-build", paths: ["go-mod", "go-build"] },
  neutralino: { id: "npm-download", paths: ["npm"] },
  tauri: { id: "cargo-registry-target", paths: ["cargo-home", "tauri-target"] },
} as const satisfies Record<Framework, { id: string; paths: readonly string[] }>;

export type RecommendedCacheDraft = {
  schemaVersion: "actutum.recommended-cache-draft/v1";
  suite: "recommended-cache";
  phase: RecommendedCachePhase;
  framework: Framework;
  frameworkRevision: string;
  sample: number;
  fixture: FixtureIdentity;
  outcome: "success" | "failure" | "timeout";
  startedAtUtc: string;
  finishedAtUtc: string;
  environment: ZeroCacheResult["environment"];
  measurement: null | {
    endToEndMs: number;
    frameworkSetupMs: number;
    buildMs: number;
    packageMs: number;
    cacheWorkingSetFiles: number;
    cacheWorkingSetBytes: number;
    outputFiles: number;
    outputBytes: number;
    outputArchiveBytes: number;
    outputArchiveSha256: string;
    intermediateFiles: number;
    intermediateBytes: number;
  };
  failure: null | { phase: string; code: string };
};

export type RecommendedCacheResult = Omit<RecommendedCacheDraft, "schemaVersion" | "measurement"> & {
  schemaVersion: typeof recommendedCacheSchemaVersion;
  cache: {
    policy: (typeof cachePolicies)[Framework]["id"];
    paths: string[];
    key: string | null;
    restoreHit: boolean | null;
    restoreMs: number;
    saveMs: number;
    archiveBytes: number;
    uploadedCacheBytes: number;
    restoredCacheBytes: number;
    evidence: "github-actions-api" | "workflow-action-output" | "not-applicable";
  };
  measurement: RecommendedCacheDraft["measurement"];
};

export type RecommendedCacheSummary = {
  schemaVersion: typeof recommendedCacheSummarySchemaVersion;
  suite: "recommended-cache";
  expectedSamples: number;
  expectedFrameworks: Framework[];
  evidenceComplete: boolean;
  comparativeClaimAllowed: false;
  rows: Array<{
    framework: Framework;
    cachePolicy: string;
    successfulPrimeSamples: number;
    successfulWarmSamples: number;
    failureCount: number;
    missingCount: number;
    archiveBytesP50: number | null;
    uploadedCacheBytesTotal: number;
    primeEndToEndP50Ms: number | null;
    warmEndToEndP50Ms: number | null;
    warmRestoreP50Ms: number | null;
    warmBuildP50Ms: number | null;
  }>;
};

function finiteNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`invalid ${label}`);
}

export function validateRecommendedCacheResult(value: unknown): asserts value is RecommendedCacheResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("recommended-cache result must be an object");
  const result = value as Partial<RecommendedCacheResult>;
  if (result.schemaVersion !== recommendedCacheSchemaVersion || result.suite !== "recommended-cache") throw new Error("unsupported recommended-cache result");
  if (!result.framework || !(result.framework in cachePolicies)) throw new Error("unknown framework");
  if (!result.phase || !recommendedCachePhases.includes(result.phase)) throw new Error("unknown phase");
  if (!Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 3) > 2) throw new Error("invalid sample");
  if (!result.cache) throw new Error("cache evidence is missing");
  const expected = cachePolicies[result.framework];
  if (result.cache.policy !== expected.id || JSON.stringify(result.cache.paths) !== JSON.stringify(expected.paths)) throw new Error("cache policy differs from framework contract");
  for (const field of ["restoreMs", "saveMs", "archiveBytes", "uploadedCacheBytes", "restoredCacheBytes"] as const) finiteNonNegative(result.cache[field], `cache.${field}`);
  if (result.framework === "actutum") {
    if (result.cache.key !== null || result.cache.restoreHit !== null || result.cache.archiveBytes !== 0 || result.cache.uploadedCacheBytes !== 0 || result.cache.restoredCacheBytes !== 0 || result.cache.evidence !== "not-applicable") throw new Error("Actutum must remain cache-free");
  } else {
    if (!result.cache.key || !["github-actions-api", "workflow-action-output"].includes(result.cache.evidence)) throw new Error("hosted cache identity is incomplete");
    if (result.phase === "prime" && result.cache.restoreHit !== false) throw new Error("prime cache must start from a miss");
    if (result.phase === "warm" && result.cache.restoreHit !== true) throw new Error("warm cache must be an exact hit");
  }
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid outcome");
  if (result.outcome === "success") {
    if (!result.measurement || result.failure !== null) throw new Error("successful result is incomplete");
    for (const field of ["endToEndMs", "frameworkSetupMs", "buildMs", "packageMs", "cacheWorkingSetFiles", "cacheWorkingSetBytes", "outputFiles", "outputBytes", "outputArchiveBytes", "intermediateFiles", "intermediateBytes"] as const) finiteNonNegative(result.measurement[field], `measurement.${field}`);
    if (!/^[0-9a-f]{64}$/.test(result.measurement.outputArchiveSha256)) throw new Error("invalid output digest");
    if (result.framework !== "actutum" && result.phase === "prime" && (result.cache.evidence !== "github-actions-api" || result.cache.uploadedCacheBytes !== result.cache.archiveBytes || result.cache.restoredCacheBytes !== 0 || result.cache.archiveBytes < 1)) throw new Error("successful prime cache evidence is invalid");
    if (result.framework !== "actutum" && result.phase === "warm" && (result.cache.evidence !== "github-actions-api" || result.cache.uploadedCacheBytes !== 0 || result.cache.restoredCacheBytes !== result.cache.archiveBytes || result.cache.archiveBytes < 1 || result.cache.saveMs !== 0)) throw new Error("successful warm cache evidence is invalid");
  } else if (result.measurement !== null || !result.failure) {
    throw new Error("failed result is incomplete");
  }
}

export function frameworksForScope(scope: string): Framework[] {
  if (scope === "all") return ["actutum", "wails", "neutralino", "tauri"];
  if (scope === "actutum-wails") return ["actutum", "wails"];
  if (scope in cachePolicies) return [scope as Framework];
  throw new Error(`unsupported recommended-cache scope: ${scope}`);
}
