import { expect, test } from "bun:test";
import { buildDelaySummary, delayTransports, delayValues, type DelayResult, type DelayTransport, type DelayValue } from "./delay-sweep-contracts";

function result(transport: DelayTransport, sample: number, delay: DelayValue, tail = false): DelayResult {
  return {
    schemaVersion: "actutum.asset-transport-delay/v2", suite: "asset-transport-relaunch-delay-sweep", framework: transport,
    frameworkRevision: "a".repeat(40), profileControl: "explicit-udf", sample, requestedDelayMs: delay, outcome: "success",
    startedAtUtc: "2026-07-15T00:00:00Z", finishedAtUtc: "2026-07-15T00:00:01Z",
    environment: { os: "windows", architecture: "amd64", runnerImage: "windows2025", runnerImageVersion: "1", webView2Version: "1", repositoryCommit: "b".repeat(40), runId: "1", runAttempt: "1" },
    measurement: {
      readyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames",
      actualProcessStartAfterFirstHostExitMs: delay + 1,
      first: { readyMs: 500, hostExitMs: 40 }, relaunched: { readyMs: tail ? 6000 : 600, hostExitMs: 40 },
    },
    failure: null,
  };
}

test("finds the first tested delay after all observed tails", () => {
  const results = delayTransports.flatMap((transport) => delayValues.map((delay) =>
    result(transport, 0, delay, transport !== "fork-file-url" && delay === 0),
  ));
  const summary = buildDelaySummary(results, 1);
  expect(summary.experimentClassification).toBe("recovery-boundary-observed");
  expect(summary.rows.find((row) => row.transport === "actutum")?.cleanFromDelayMs).toBe(100);
  expect(summary.rows.find((row) => row.transport === "fork-file-url")?.cleanFromDelayMs).toBe(0);
});

test("does not claim recovery when the largest tested delay still tails", () => {
  const results = delayTransports.flatMap((transport) => delayValues.map((delay) =>
    result(transport, 0, delay, transport === "actutum" && delay === 1000),
  ));
  const summary = buildDelaySummary(results, 1);
  expect(summary.experimentClassification).toBe("not-recovered-within-range");
  expect(summary.rows.find((row) => row.transport === "actutum")?.cleanFromDelayMs).toBeNull();
});

test("keeps an incomplete sweep non-conclusive", () => {
  const summary = buildDelaySummary([result("actutum", 0, 0)], 1);
  expect(summary.experimentClassification).toBe("insufficient-evidence");
  expect(summary.publishable).toBeFalse();
});

test("ten complete samples are publishable", () => {
  const results = delayTransports.flatMap((transport) => delayValues.flatMap((delay) =>
    Array.from({ length: 10 }, (_, sample) => result(transport, sample, delay)),
  ));
  expect(buildDelaySummary(results, 10).publishable).toBeTrue();
});
