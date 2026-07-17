import { expect, test } from "bun:test";
import type { Framework, Result } from "./contracts";
import { buildPairSummary } from "./pair-summary";

function result(framework: Framework, sample: number, duration: number, cpuModel = "EPYC 7763", outcome: Result["outcome"] = "success"): Result {
  return {
    schemaVersion: "velox.bench-result/v1",
    suite: "zero-cache",
    framework,
    frameworkRevision: framework.charCodeAt(0).toString(16).padStart(40, "0"),
    sample,
    fixtureSha256: "b".repeat(64),
    outcome,
    startedAtUtc: "2026-07-17T00:00:00.000Z",
    finishedAtUtc: "2026-07-17T00:00:01.000Z",
    environment: {
      runner: "windows-2025",
      runnerImageVersion: "stable",
      os: "windows",
      architecture: "amd64",
      windowsVersion: "10.0",
      cpuModel,
      logicalProcessors: 4,
      memoryBytes: 16 * 1024 ** 3,
      bunVersion: "1.3.14",
      repositoryCommit: "c",
      runId: "1",
      runAttempt: "1",
    },
    measurement: outcome === "success" ? {
      endToEndMs: duration,
      frameworkSetupMs: 1,
      buildMs: 1,
      packageMs: 1,
      acquisitionWorkingSetBytes: 1,
      outputFiles: 1,
      outputBytes: 1,
      outputArchiveBytes: 1,
      outputArchiveSha256: "c".repeat(64),
      intermediateFiles: 0,
      intermediateBytes: 0,
      uploadedCacheBytes: 0,
      cacheEvidence: "workflow-source-audit",
    } : null,
    failure: outcome === "success" ? null : { phase: "build", code: "PHASE_FAILED" },
  };
}

function pair(count: number): Result[] {
  return (["velox", "wails"] as Framework[]).flatMap((framework) =>
    Array.from({ length: count }, (_, sample) => result(framework, sample, framework === "velox" ? 100 : 400)),
  );
}

test("ten complete Velox and Wails samples form publishable pair evidence", () => {
  const summary = buildPairSummary(pair(10), 10);
  expect(summary.scope).toBe("velox-wails");
  expect(summary.rows).toHaveLength(2);
  expect(summary.publishable).toBeTrue();
});

test("pair summary rejects unrelated framework evidence", () => {
  expect(() => buildPairSummary([...pair(10), result("tauri", 0, 800)], 10)).toThrow("outside velox-wails scope");
});

test("pair summary preserves failures and remains non-publishable", () => {
  const results = pair(10);
  results[13] = result("wails", 3, 400, "EPYC 7763", "failure");
  const summary = buildPairSummary(results, 10);
  expect(summary.publishable).toBeFalse();
  expect(summary.rows.find((row) => row.framework === "wails")?.failed).toBe(1);
});

test("unbalanced pair CPU assignment remains visible and non-publishable", () => {
  const results = (["velox", "wails"] as Framework[]).flatMap((framework) =>
    Array.from({ length: 10 }, (_, sample) => result(framework, sample, framework === "velox" ? 100 : 400, framework === "velox" ? "EPYC 7763" : "EPYC 9V74")),
  );
  const summary = buildPairSummary(results, 10);
  expect(summary.hardwareBalanced).toBeFalse();
  expect(summary.publishable).toBeFalse();
});
