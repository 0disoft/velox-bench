import { expect, test } from "bun:test";
import type { Framework, Result } from "./contracts";
import { buildPairSummary } from "./pair-summary";

function result(framework: Framework, sample: number, duration: number, cpuModel = "EPYC 7763", outcome: Result["outcome"] = "success"): Result {
  return {
    schemaVersion: "actutum.bench-result/v3",
    suite: "zero-cache",
    framework,
    frameworkRevision: framework.charCodeAt(0).toString(16).padStart(40, "0"),
    sample,
    fixture: { name: "hello", sha256: "b".repeat(64), generatedFiles: 0, generatedBytes: 0 },
    outcome,
    startedAtUtc: framework === "actutum" ? "2026-07-17T00:00:00.000Z" : "2026-07-17T00:00:02.000Z",
    finishedAtUtc: framework === "actutum" ? "2026-07-17T00:00:01.000Z" : "2026-07-17T00:00:03.000Z",
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
  return (["actutum", "wails"] as Framework[]).flatMap((framework) =>
    Array.from({ length: count }, (_, sample) => result(framework, sample, framework === "actutum" ? 100 : 400)),
  );
}

test("ten complete Actutum and Wails samples form publishable pair evidence", () => {
  const summary = buildPairSummary(pair(10), 10);
  expect(summary.scope).toBe("actutum-wails");
  expect(summary.rows).toHaveLength(2);
  expect(summary.publishable).toBeTrue();
});

test("pair summary rejects unrelated framework evidence", () => {
  expect(() => buildPairSummary([...pair(10), result("tauri", 0, 800)], 10)).toThrow("outside actutum-wails scope");
});

test("pair summary preserves failures and remains non-publishable", () => {
  const results = pair(10);
  results[13] = result("wails", 3, 400, "EPYC 7763", "failure");
  const summary = buildPairSummary(results, 10);
  expect(summary.publishable).toBeFalse();
  expect(summary.rows.find((row) => row.framework === "wails")?.failed).toBe(1);
});

test("pair summary rejects samples that do not share exact runner hardware", () => {
  const results = (["actutum", "wails"] as Framework[]).flatMap((framework) =>
    Array.from({ length: 10 }, (_, sample) => result(framework, sample, framework === "actutum" ? 100 : 400, framework === "actutum" ? "EPYC 7763" : "EPYC 9V74")),
  );
  expect(() => buildPairSummary(results, 10)).toThrow("does not share exact runner hardware");
});

test("pair summary rejects overlapping execution intervals", () => {
  const results = pair(10);
  const wails = results.find((entry) => entry.framework === "wails" && entry.sample === 0)!;
  wails.startedAtUtc = "2026-07-17T00:00:00.500Z";
  expect(() => buildPairSummary(results, 10)).toThrow("execution intervals overlap");
});

test("pair summary rejects asset-pack evidence", () => {
  const results = pair(10);
  for (const entry of results) {
    entry.fixture = { name: "asset-pack", sha256: "d".repeat(64), generatedFiles: 1000, generatedBytes: 10 * 1024 * 1024 };
  }
  expect(() => buildPairSummary(results, 10)).toThrow("hello fixture");
});
