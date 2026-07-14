import { expect, test } from "bun:test";
import { buildStartupSummary, hostTimelineClock, hostTimelinePrefix, hostTimelineSchemaVersion, parseHostTimelineOutput, readyBoundary, startupPhaseNames, startupSchemaVersion, startupSuite, validateStartupResult, warmupCount, type HostStartupTimeline, type StartupResult } from "./startup-contracts";

function timeline(readyMs: number): HostStartupTimeline {
  return {
    schemaVersion: hostTimelineSchemaVersion,
    clock: hostTimelineClock,
    phases: startupPhaseNames.map((name, index) => ({
      name,
      elapsedMs: index === 0 ? 0 : Math.min(readyMs, index * 5),
    })),
  };
}

function result(sample: number, overrides: Partial<StartupResult> = {}): StartupResult {
  return {
    schemaVersion: startupSchemaVersion,
    suite: startupSuite,
    framework: "velox",
    frameworkRevision: "a".repeat(40),
    evidenceLevel: "hosted-pinned-source",
    sample,
    fixtureSha256: "b".repeat(64),
    outcome: "success",
    startedAtUtc: "2026-07-14T00:00:00.000Z",
    finishedAtUtc: "2026-07-14T00:00:01.000Z",
    environment: {
      runner: "windows-2025",
      runnerImageVersion: "20260701.1",
      windowsVersion: "10.0.26100",
      cpuModel: "benchmark cpu",
      logicalProcessors: 4,
      memoryBytes: 16 * 1024 * 1024 * 1024,
      bunVersion: "1.3.14",
      repositoryCommit: "c".repeat(40),
      runId: "1",
      runAttempt: "1",
      webView2Version: "140.0.0.0",
    },
    measurement: {
      readyBoundary,
      warmupCount,
      fresh: { readyMs: 100 + sample, hostExitAfterReadyMs: 10, browserExitAfterHostMs: 20, profileReleaseAfterHostMs: 30, browserProcessId: 1000 + sample, hostTimeline: timeline(100 + sample) },
      warm: { readyMs: 80 + sample, hostExitAfterReadyMs: 10, browserExitAfterHostMs: 20, profileReleaseAfterHostMs: 30, browserProcessId: 2000 + sample, hostTimeline: timeline(80 + sample) },
    },
    failure: null,
    ...overrides,
  };
}

test("validates the process-to-two-frame startup contract", () => {
  expect(() => validateStartupResult(result(0))).not.toThrow();
});

test("parses exactly one ordered host startup timeline", () => {
  const expected = timeline(100);
  const stderr = `diagnostic\n${hostTimelinePrefix}${JSON.stringify(expected)}\n`;
  expect(parseHostTimelineOutput(stderr, 100)).toEqual(expected);
});

test("rejects a missing or reordered host startup timeline", () => {
  expect(() => parseHostTimelineOutput("", 100)).toThrow("found 0");
  const reordered = timeline(100);
  [reordered.phases[4], reordered.phases[5]] = [reordered.phases[5], reordered.phases[4]];
  expect(() => parseHostTimelineOutput(`${hostTimelinePrefix}${JSON.stringify(reordered)}\n`, 100)).toThrow("environment-create-started");
});

test("rejects a host timeline that exceeds process-to-ready", () => {
  const tooLong = timeline(100);
  tooLong.phases[tooLong.phases.length - 1].elapsedMs = 101;
  expect(() => validateStartupResult(result(0, {
    measurement: {
      readyBoundary,
      warmupCount,
      fresh: { ...result(0).measurement!.fresh, hostTimeline: tooLong },
      warm: result(0).measurement!.warm,
    },
  }))).toThrow("successful startup result is incomplete");
});

test("three samples remain diagnostic", () => {
  const summary = buildStartupSummary([result(0), result(1), result(2)], 3);
  expect(summary.publishable).toBe(false);
  expect(summary.successful).toBe(3);
  expect(summary.fresh?.p95Ms).toBe(102);
  expect(summary.warm?.p50Ms).toBe(81);
});

test("ten complete samples in one environment are publishable", () => {
  const summary = buildStartupSummary(Array.from({ length: 10 }, (_, sample) => result(sample)), 10);
  expect(summary.publishable).toBe(true);
  expect(summary.missing).toBe(0);
});

test("mixed runner environments are not publishable", () => {
  const results = Array.from({ length: 10 }, (_, sample) => result(sample));
  results[9] = result(9, { environment: { ...results[9].environment, runnerImageVersion: "20260708.1" } });
  const summary = buildStartupSummary(results, 10);
  expect(summary.publishable).toBe(false);
  expect(summary.environmentGroups).toHaveLength(2);
});

test("hosted hardware variation stays in one environment group", () => {
  const results = Array.from({ length: 10 }, (_, sample) => result(sample));
  results[9] = result(9, { environment: { ...results[9].environment, cpuModel: "different hosted cpu", memoryBytes: 32 * 1024 * 1024 * 1024 } });
  const summary = buildStartupSummary(results, 10);
  expect(summary.publishable).toBe(true);
  expect(summary.environmentGroups).toHaveLength(1);
});

test("local release evidence is never publishable", () => {
  const results = Array.from({ length: 10 }, (_, sample) => result(sample, { evidenceLevel: "local-unverified-release" }));
  expect(buildStartupSummary(results, 10).publishable).toBe(false);
});

test("duplicate samples are rejected", () => {
  expect(() => buildStartupSummary([result(0), result(0)], 3)).toThrow("duplicate startup sample 0");
});
