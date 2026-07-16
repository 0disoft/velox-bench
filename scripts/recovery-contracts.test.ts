import { expect, test } from "bun:test";
import {
  buildRecoverySummary,
  recoveryDelays,
  recoveryScenarios,
  validateRecoveryResult,
  type DiagnosticLaunch,
  type RecoveryDelay,
  type RecoveryFramework,
  type RecoveryResult,
  type RecoveryScenario,
} from "./recovery-contracts";

const scenarioFramework: Record<RecoveryScenario, RecoveryFramework> = {
  "velox-same-profile": "velox",
  "velox-fresh-profile": "velox",
  "file-url-same-profile": "fork-file-url",
  "file-url-fresh-profile": "fork-file-url",
  "virtual-host-same-profile": "fork-virtual-host",
  "virtual-host-fresh-profile": "fork-virtual-host",
  "virtual-host-fresh-origin": "fork-virtual-host",
};

function launch(readyMs: number, environmentCreateMs = 20, browserExitMs: number | null = 200, browserProcessId = 200): DiagnosticLaunch {
  return {
    readyMs, hostExitMs: 40, hostProcessId: 100, browserProcessId,
    browserExitAfterHostExitMs: browserExitMs,
    startupTimeline: {
      schemaVersion: "velox.host-startup-timeline/v1", clock: "time-since-host-entry-monotonic",
      phases: [
        { name: "host-entry", elapsedMs: 0 },
        { name: "environment-create-started", elapsedMs: 5 },
        { name: "environment-created", elapsedMs: 5 + environmentCreateMs },
        { name: "controller-created", elapsedMs: 35 + environmentCreateMs },
        { name: "navigation-dispatched", elapsedMs: 40 + environmentCreateMs },
        { name: "dom-2raf", elapsedMs: readyMs },
      ],
    },
    shutdownTimeline: {
      schemaVersion: "velox.host-shutdown-timeline/v1", clock: "time-since-shutdown-request-monotonic",
      phases: [{ name: "window-close-dispatched", elapsedMs: 0 }, { name: "run-loop-exited", elapsedMs: 4 }],
    },
  };
}

function result(scenario: RecoveryScenario, sample: number, delay: RecoveryDelay, tail = false): RecoveryResult {
  const sharedBrowserProcess = !scenario.endsWith("fresh-profile");
  return {
    schemaVersion: "velox.asset-transport-recovery/v1", suite: "asset-transport-recovery-boundary",
    framework: scenarioFramework[scenario], frameworkRevision: "a".repeat(40), profileControl: "explicit-udf",
    sample, scenario, requestedDelayMs: delay, outcome: "success",
    startedAtUtc: "2026-07-15T00:00:00Z", finishedAtUtc: "2026-07-15T00:00:01Z",
    environment: {
      os: "windows", architecture: "amd64", runnerImage: "windows2025", runnerImageVersion: "1",
      webView2Version: "1", repositoryCommit: "b".repeat(40), runId: "1", runAttempt: "1",
    },
    measurement: {
      readyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
      actualProcessStartAfterFirstHostExitMs: delay + 1,
      browserExitObservationTimeoutMs: 15000,
      firstBrowserRunningAtRelaunchStart: true,
      browserProcessSharedAcrossPair: sharedBrowserProcess,
      first: launch(500, 20, delay + 200),
      relaunched: launch(tail ? 6000 : 600, tail ? 5200 : 25, 200, sharedBrowserProcess ? 200 : 201),
    },
    failure: null,
  };
}

test("extracts the WebView2 environment interval from lifecycle phases", () => {
  const summary = buildRecoverySummary(recoveryScenarios.flatMap((scenario) => recoveryDelays.map((delay) => result(scenario, 0, delay))), 1);
  const cell = summary.rows.find((row) => row.scenario === "velox-same-profile")!.cells[0];
  expect(cell.firstEnvironmentCreate?.p50Ms).toBe(20);
  expect(cell.relaunchedEnvironmentCreate?.p50Ms).toBe(25);
  expect(cell.relaunchedReadyAfterFirstBrowserExit?.p50Ms).toBe(401);
  expect(cell.firstBrowserRunningAtRelaunchSamples).toBe(1);
  expect(cell.sharedBrowserProcessSamples).toBe(1);
  expect(cell.firstBrowserExitObservedSamples).toBe(1);
  expect(cell.relaunchedBrowserExitObservedSamples).toBe(1);
  expect(cell.dominantRelaunchPhase).toBe("post-controller");
});

test("finds a bounded same-profile recovery while fresh profiles remain clean", () => {
  const results = recoveryScenarios.flatMap((scenario) => recoveryDelays.map((delay) =>
    result(scenario, 0, delay, scenario === "virtual-host-same-profile" && delay < 6000),
  ));
  const summary = buildRecoverySummary(results, 1);
  expect(summary.experimentClassification).toBe("recovery-boundary-observed");
  expect(summary.rows.find((row) => row.scenario === "virtual-host-same-profile")?.cleanFromDelayMs).toBe(6000);
  expect(summary.rows.find((row) => row.scenario === "virtual-host-fresh-profile")?.cleanFromDelayMs).toBe(0);
});

test("rejects a reordered startup timeline", () => {
  const candidate = result("velox-same-profile", 0, 0);
  candidate.measurement!.first.startupTimeline.phases[2].elapsedMs = 1;
  expect(() => validateRecoveryResult(candidate)).toThrow("phase order");
});

test("rejects a browser sharing flag that contradicts process IDs", () => {
  const candidate = result("velox-same-profile", 0, 0);
  candidate.measurement!.browserProcessSharedAcrossPair = false;
  expect(() => validateRecoveryResult(candidate)).toThrow("sharing flag");
});

test("ten complete samples in one environment are publishable", () => {
  const results = recoveryScenarios.flatMap((scenario) => recoveryDelays.flatMap((delay) =>
    Array.from({ length: 10 }, (_, sample) => result(scenario, sample, delay)),
  ));
  const summary = buildRecoverySummary(results, 10);
  expect(summary.observed).toBe(420);
  expect(summary.publishable).toBeTrue();
});
