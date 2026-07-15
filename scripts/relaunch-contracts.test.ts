import { expect, test } from "bun:test";
import { buildRelaunchSummary, relaunchFrameworks, type RelaunchFramework, type RelaunchResult } from "./relaunch-contracts";

function result(framework: RelaunchFramework, sample: number, first = 500, immediate = 6000): RelaunchResult {
  return {
    schemaVersion: "velox.relaunch-control/v1", suite: "same-profile-immediate-relaunch", framework,
    frameworkRevision: "a".repeat(40), profileControl: framework === "neutralino" ? "framework-managed-app-directory" : "explicit-udf",
    sample, outcome: "success", startedAtUtc: "2026-07-15T00:00:00Z", finishedAtUtc: "2026-07-15T00:00:01Z",
    environment: { os: "windows", architecture: "amd64", runnerImage: "windows2025", runnerImageVersion: "1", webView2Version: "1", repositoryCommit: "b".repeat(40), runId: "1", runAttempt: "1" },
    measurement: { readyBoundary: "process-start-to-window-title-after-domcontentloaded-plus-two-animation-frames", immediateProcessStartAfterFirstHostExitMs: 1, first: { readyMs: first, hostExitMs: 40 }, immediate: { readyMs: immediate, hostExitMs: 40 } },
    failure: null,
  };
}

test("classifies a delay shared by all controls", () => {
  const summary = buildRelaunchSummary(relaunchFrameworks.flatMap((framework) => [0, 1, 2].map((sample) => result(framework, sample))), 3);
  expect(summary.platformClassification).toBe("shared-immediate-relaunch-delay");
  expect(summary.publishable).toBeFalse();
});

test("keeps incomplete framework evidence non-conclusive", () => {
  const summary = buildRelaunchSummary(relaunchFrameworks.map((framework) => result(framework, 0)), 3);
  expect(summary.rows.every((row) => row.delayClassification === "insufficient-evidence")).toBeTrue();
  expect(summary.platformClassification).toBe("mixed-or-not-observed");
});
