import { expect, test } from "bun:test";
import type { Framework, Result } from "./contracts";
import { buildSummary } from "./summary";

function result(framework: Framework, sample: number, outcome: Result["outcome"] = "success"): Result {
  return {
    schemaVersion: "velox.bench-result/v1",
    suite: "zero-cache",
    framework,
    frameworkRevision: framework.charCodeAt(0).toString(16).padStart(40, "0"),
    sample,
    fixtureSha256: "b".repeat(64),
    outcome,
    startedAtUtc: "2026-07-13T00:00:00.000Z",
    finishedAtUtc: "2026-07-13T00:00:01.000Z",
    environment: { runner: "windows-2025", runnerImageVersion: "x", os: "windows", architecture: "amd64", windowsVersion: "10.0", cpuModel: "test", logicalProcessors: 2, memoryBytes: 1024, bunVersion: "1.3.14", repositoryCommit: "c", runId: "1", runAttempt: "1" },
    measurement: outcome === "success" ? { endToEndMs: sample + 1, frameworkSetupMs: 1, buildMs: 1, packageMs: 1, acquisitionWorkingSetBytes: 1, outputFiles: 1, outputBytes: 1, outputArchiveBytes: 1, outputArchiveSha256: "c".repeat(64), intermediateFiles: 0, intermediateBytes: 0, uploadedCacheBytes: 0, cacheEvidence: "workflow-source-audit" } : null,
    failure: outcome === "success" ? null : { phase: "build", code: outcome === "timeout" ? "DEADLINE_EXCEEDED" : "PHASE_FAILED" },
  };
}

test("one sample per framework is diagnostic, not publishable", () => {
  const summary = buildSummary((["velox", "wails", "neutralino", "tauri"] as Framework[]).map((framework) => result(framework, 0)), 1);
  expect(summary.publishable).toBe(false);
  expect(summary.rows.every((row) => row.successful === 1)).toBe(true);
});

test("three samples per framework are a diagnostic pilot, not publishable", () => {
  const results = (["velox", "wails", "neutralino", "tauri"] as Framework[]).flatMap((framework) =>
    Array.from({ length: 3 }, (_, sample) => result(framework, sample)),
  );
  const summary = buildSummary(results, 3);
  expect(summary.publishable).toBe(false);
  expect(summary.rows.every((row) => row.successful === 3 && row.missing === 0)).toBe(true);
});

test("ten complete successful samples per framework are publishable", () => {
  const results = (["velox", "wails", "neutralino", "tauri"] as Framework[]).flatMap((framework) =>
    Array.from({ length: 10 }, (_, sample) => result(framework, sample)),
  );
  expect(buildSummary(results, 10).publishable).toBe(true);
});

test("failures remain counted and prevent publication", () => {
  const results = (["velox", "wails", "neutralino", "tauri"] as Framework[]).flatMap((framework) =>
    Array.from({ length: 10 }, (_, sample) => result(framework, sample, framework === "wails" && sample === 3 ? "failure" : "success")),
  );
  const summary = buildSummary(results, 10);
  expect(summary.publishable).toBe(false);
  expect(summary.rows.find((row) => row.framework === "wails")?.failed).toBe(1);
});

test("duplicate sample IDs are rejected", () => {
  expect(() => buildSummary([result("velox", 0), result("velox", 0)], 1)).toThrow("duplicate sample");
});
