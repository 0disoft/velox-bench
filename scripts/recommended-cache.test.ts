import { describe, expect, test } from "bun:test";
import { buildRecommendedCacheSummary } from "./summarize-recommended-cache";
import { cachePolicies, validateRecommendedCacheResult, type RecommendedCacheResult } from "./recommended-cache-contracts";

function result(framework: "actutum" | "wails", phase: "prime" | "warm", sample = 0): RecommendedCacheResult {
  const cacheFree = framework === "actutum";
  const archiveBytes = cacheFree ? 0 : 100;
  return {
    schemaVersion: "actutum.recommended-cache-result/v2",
    suite: "recommended-cache",
    phase,
    framework,
    frameworkRevision: "a".repeat(40),
    sample,
    fixture: { name: "hello", sha256: "b".repeat(64), generatedFiles: 0, generatedBytes: 0 },
    outcome: "success",
    startedAtUtc: "2026-07-18T00:00:00Z",
    finishedAtUtc: "2026-07-18T00:00:01Z",
    environment: {
      runner: "windows-2025", os: "windows", architecture: "amd64", runnerImageVersion: "x", windowsVersion: "y", cpuModel: "z", logicalProcessors: 4, memoryBytes: 1,
      bunVersion: "1.3.14", repositoryCommit: "c".repeat(40), runId: "1", runAttempt: "1",
    },
    cache: {
      policy: cachePolicies[framework].id,
      paths: [...cachePolicies[framework].paths],
      key: cacheFree ? null : "k",
      restoreHit: cacheFree ? null : phase === "warm",
      restoreMs: cacheFree ? 0 : 10,
      saveMs: !cacheFree && phase === "prime" ? 20 : 0,
      archiveBytes,
      uploadedCacheBytes: !cacheFree && phase === "prime" ? archiveBytes : 0,
      restoredCacheBytes: !cacheFree && phase === "warm" ? archiveBytes : 0,
      evidence: cacheFree ? "not-applicable" : "github-actions-api",
    },
    measurement: {
      endToEndMs: phase === "prime" ? 1000 : 500,
      frameworkSetupMs: 100,
      buildMs: phase === "prime" ? 800 : 300,
      packageMs: 50,
      cacheWorkingSetFiles: cacheFree ? 0 : 2,
      cacheWorkingSetBytes: cacheFree ? 0 : 200,
      outputFiles: 1,
      outputBytes: 10,
      outputArchiveBytes: 8,
      outputArchiveSha256: "d".repeat(64),
      intermediateFiles: 0,
      intermediateBytes: 0,
    },
    failure: null,
  };
}

describe("recommended-cache contracts", () => {
  test("accepts cache-free Actutum and exact Wails restore evidence", () => {
    for (const value of [result("actutum", "prime"), result("actutum", "warm"), result("wails", "prime"), result("wails", "warm")]) expect(() => validateRecommendedCacheResult(value)).not.toThrow();
  });

  test("summarizes a complete Actutum-Wails pair without enabling a winner claim", () => {
    const summary = buildRecommendedCacheSummary([result("actutum", "prime"), result("actutum", "warm"), result("wails", "prime"), result("wails", "warm")], 1, "actutum-wails");
    expect(summary.evidenceComplete).toBe(true);
    expect(summary.comparativeClaimAllowed).toBe(false);
    expect(summary.rows[1].archiveBytesP50).toBe(100);
  });

  test("keeps missing warm evidence visible", () => {
    const summary = buildRecommendedCacheSummary([result("wails", "prime")], 1, "wails");
    expect(summary.evidenceComplete).toBe(false);
    expect(summary.rows[0].missingCount).toBe(1);
  });

  test("preserves a prime build failure before any cache archive exists", () => {
    const failed = result("wails", "prime");
    failed.outcome = "failure";
    failed.measurement = null;
    failed.failure = { phase: "framework-setup-and-build", code: "PHASE_FAILED" };
    failed.cache.archiveBytes = 0;
    failed.cache.uploadedCacheBytes = 0;
    failed.cache.saveMs = 0;
    failed.cache.evidence = "workflow-action-output";
    expect(() => validateRecommendedCacheResult(failed)).not.toThrow();
  });
});
