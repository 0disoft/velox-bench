import { expect, test } from "bun:test";
import { buildRelaunchSummary, relaunchFrameworks, type RelaunchFramework, type RelaunchResult } from "./relaunch-contracts";

function result(framework: RelaunchFramework, sample: number, first = 500, immediate = 6000): RelaunchResult {
  return {
    schemaVersion: "actutum.relaunch-control/v2", suite: "same-profile-immediate-relaunch", framework,
    frameworkRevision: "a".repeat(40), profileControl: framework === "neutralino" ? "framework-managed-app-directory" : "explicit-udf",
    sample, outcome: "success", startedAtUtc: "2026-07-15T00:00:00Z", finishedAtUtc: "2026-07-15T00:00:01Z",
    environment: { os: "windows", architecture: "amd64", runnerImage: "windows2025", runnerImageVersion: "1", webView2Version: "1", repositoryCommit: "b".repeat(40), runId: "1", runAttempt: "1" },
    measurement: { readyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames", immediateProcessStartAfterFirstHostExitMs: 1, first: { readyMs: first, hostExitMs: 40 }, immediate: { readyMs: immediate, hostExitMs: 40 } },
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

test("classifies a delay observed only in Actutum", () => {
  const results = relaunchFrameworks.flatMap((framework) => [0, 1, 2].map((sample) =>
    result(framework, sample, 500, framework === "actutum" ? 6000 : 600),
  ));
  const summary = buildRelaunchSummary(results, 3);
  expect(summary.platformClassification).toBe("actutum-specific-delay");
  expect(summary.rows[0].pairedDelaySamples).toBe(3);
  expect(summary.rows[0].pairedDelayRate).toBe(1);
});

test("preserves an intermittent paired delay hidden by the median", () => {
  const immediate = [5989, 422, 6191, 6027, 536, 6064, 489, 487, 568, 516];
  const first = [2414, 4535, 2234, 2210, 2550, 2202, 2296, 2520, 2653, 2675];
  const results = immediate.map((ready, sample) => result("actutum", sample, first[sample], ready));
  const summary = buildRelaunchSummary(results, 10);
  const actutum = summary.rows[0];

  expect(actutum.immediateReady?.p50Ms).toBe(536);
  expect(actutum.pairedDelaySamples).toBe(4);
  expect(actutum.pairedDelayRate).toBe(0.4);
  expect(actutum.delayClassification).toBe("observed");
  expect(summary.platformClassification).toBe("mixed-or-not-observed");
});
