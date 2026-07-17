import { expect, test } from "bun:test";
import type { Framework, Result } from "./contracts";
import { buildPairDecision } from "./pair-decision";
import { buildPairSummary } from "./pair-summary";

function result(framework: Framework, sample: number, duration: number): Result {
  return {
    schemaVersion: "velox.bench-result/v1",
    suite: "zero-cache",
    framework,
    frameworkRevision: framework.charCodeAt(0).toString(16).padStart(40, "0"),
    sample,
    fixtureSha256: "b".repeat(64),
    outcome: "success",
    startedAtUtc: framework === "velox" ? "2026-07-17T00:00:00.000Z" : "2026-07-17T00:00:02.000Z",
    finishedAtUtc: framework === "velox" ? "2026-07-17T00:00:01.000Z" : "2026-07-17T00:00:03.000Z",
    environment: { runner: "windows-2025", runnerImageVersion: "stable", os: "windows", architecture: "amd64", windowsVersion: "10.0", cpuModel: "EPYC 7763", logicalProcessors: 4, memoryBytes: 16 * 1024 ** 3, bunVersion: "1.3.14", repositoryCommit: "c", runId: "1", runAttempt: "1" },
    measurement: { endToEndMs: duration, frameworkSetupMs: 1, buildMs: 1, packageMs: 1, acquisitionWorkingSetBytes: 1, outputFiles: 1, outputBytes: 1, outputArchiveBytes: 1, outputArchiveSha256: "c".repeat(64), intermediateFiles: 0, intermediateBytes: 0, uploadedCacheBytes: 0, cacheEvidence: "workflow-source-audit" },
    failure: null,
  };
}

function summary(samples: number, wailsDuration: number) {
  return buildPairSummary((["velox", "wails"] as Framework[]).flatMap((framework) =>
    Array.from({ length: samples }, (_, sample) => result(framework, sample, framework === "velox" ? 100 : wailsDuration)),
  ), samples);
}

test("publishable pair evidence passes at or above three times speedup", () => {
  const decision = buildPairDecision(summary(10, 400));
  expect(decision.scope).toBe("velox-wails");
  expect(decision.status).toBe("passed");
  expect(decision.metrics.wailsToVeloxP50Ratio).toBe(4);
  expect(decision.questionsRequired).toBeFalse();
});

test("publishable pair evidence fails below target and requests expert questions", () => {
  const decision = buildPairDecision(summary(10, 250));
  expect(decision.status).toBe("failed");
  expect(decision.gates.minimumSpeedup).toBeFalse();
  expect(decision.questionsRequired).toBeTrue();
});

test("three-sample pair evidence remains diagnostic", () => {
  const decision = buildPairDecision(summary(3, 400));
  expect(decision.evidenceLevel).toBe("diagnostic");
  expect(decision.status).toBe("promising");
});
