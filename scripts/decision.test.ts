import { expect, test } from "bun:test";
import { buildDecision } from "./decision";
import { buildSummary } from "./summary";
import type { Framework, Result } from "./contracts";

function result(framework: Framework, sample: number, duration: number, image = "stable", cpuModel = "test"): Result {
  return {
    schemaVersion: "velox.bench-result/v1", suite: "zero-cache", framework,
    frameworkRevision: framework.charCodeAt(0).toString(16).padStart(40, "0"), sample,
    fixtureSha256: "b".repeat(64), outcome: "success",
    startedAtUtc: "2026-07-17T00:00:00.000Z", finishedAtUtc: "2026-07-17T00:00:01.000Z",
    environment: { runner: "windows-2025", runnerImageVersion: image, os: "windows", architecture: "amd64", windowsVersion: "10.0", cpuModel, logicalProcessors: 4, memoryBytes: 1024, bunVersion: "1.3.14", repositoryCommit: "c", runId: "1", runAttempt: "1" },
    measurement: { endToEndMs: duration, frameworkSetupMs: 1, buildMs: 1, packageMs: 1, acquisitionWorkingSetBytes: 1, outputFiles: 1, outputBytes: 1, outputArchiveBytes: 1, outputArchiveSha256: "c".repeat(64), intermediateFiles: 0, intermediateBytes: 0, uploadedCacheBytes: 0, cacheEvidence: "workflow-source-audit" },
    failure: null,
  };
}

function pilot(wailsDuration: number, imageForLast = "stable") {
  const frameworks = ["velox", "wails", "neutralino", "tauri"] as Framework[];
  return buildSummary(frameworks.flatMap((framework) => Array.from({ length: 3 }, (_, sample) =>
    result(framework, sample, framework === "velox" ? 100 : framework === "wails" ? wailsDuration : 200, framework === "tauri" && sample === 2 ? imageForLast : "stable"),
  )), 3);
}

test("three-sample pilot is promising at or above the speed target", () => {
  const decision = buildDecision(pilot(350));
  expect(decision.status).toBe("promising");
  expect(decision.metrics.wailsToVeloxP50Ratio).toBe(3.5);
  expect(decision.questionsRequired).toBeFalse();
});

test("three-sample pilot below the target requests expert questions", () => {
  const decision = buildDecision(pilot(250));
  expect(decision.status).toBe("below-target");
  expect(decision.gates.minimumSpeedup).toBeFalse();
  expect(decision.questionsRequired).toBeTrue();
});

test("mixed environments remain inconclusive instead of failing the product", () => {
  const decision = buildDecision(pilot(350, "rollout"));
  expect(decision.status).toBe("insufficient-evidence");
  expect(decision.gates.singleEnvironment).toBeFalse();
  expect(decision.questionsRequired).toBeFalse();
});

test("unbalanced hosted CPU assignment remains inconclusive", () => {
  const frameworks = ["velox", "wails", "neutralino", "tauri"] as Framework[];
  const summary = buildSummary(frameworks.flatMap((framework) => Array.from({ length: 3 }, (_, sample) =>
    result(framework, sample, framework === "velox" ? 100 : framework === "wails" ? 350 : 200, "stable", framework === "tauri" ? "EPYC 9V74" : "EPYC 7763"),
  )), 3);
  const decision = buildDecision(summary);
  expect(decision.status).toBe("insufficient-evidence");
  expect(decision.gates.hardwareBalanced).toBeFalse();
});
