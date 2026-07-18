import { expect, test } from "bun:test";
import { buildTransportSummary, transports, type Transport, type TransportResult } from "./transport-contracts";

function result(transport: Transport, sample: number, first = 500, immediate = 600): TransportResult {
  return {
    schemaVersion: "actutum.asset-transport-relaunch/v2", suite: "asset-transport-immediate-relaunch", framework: transport,
    frameworkRevision: "a".repeat(40), profileControl: "explicit-udf", sample, outcome: "success",
    startedAtUtc: "2026-07-15T00:00:00Z", finishedAtUtc: "2026-07-15T00:00:01Z",
    environment: { os: "windows", architecture: "amd64", runnerImage: "windows2025", runnerImageVersion: "1", webView2Version: "1", repositoryCommit: "b".repeat(40), runId: "1", runAttempt: "1" },
    measurement: { readyBoundary: "process-start-to-framework-ready-after-domcontentloaded-plus-two-animation-frames", immediateProcessStartAfterFirstHostExitMs: 1, first: { readyMs: first, hostExitMs: 40 }, immediate: { readyMs: immediate, hostExitMs: 40 } },
    failure: null,
  };
}

test("attributes paired tails shared by Actutum and the virtual-host control", () => {
  const results = transports.flatMap((transport) => [0, 1, 2].map((sample) =>
    result(transport, sample, 500, transport === "actutum" || transport === "fork-virtual-host" ? 6000 : 600),
  ));
  const summary = buildTransportSummary(results, 3);
  expect(summary.transportClassification).toBe("virtual-host-mapping-delay");
  expect(summary.rows.find((row) => row.transport === "fork-web-resource")?.pairedDelaySamples).toBe(0);
});

test("does not make a transport attribution from incomplete controls", () => {
  const summary = buildTransportSummary([result("actutum", 0, 500, 6000)], 1);
  expect(summary.transportClassification).toBe("insufficient-evidence");
  expect(summary.publishable).toBeFalse();
});

test("preserves an intermittent virtual-host tail", () => {
  const results = transports.flatMap((transport) => Array.from({ length: 10 }, (_, sample) =>
    result(transport, sample, 2400, transport === "fork-virtual-host" && sample < 4 ? 6000 : 500),
  ));
  const summary = buildTransportSummary(results, 10);
  const mapped = summary.rows.find((row) => row.transport === "fork-virtual-host")!;
  expect(mapped.pairedDelaySamples).toBe(4);
  expect(mapped.pairedDelayRate).toBe(0.4);
  expect(summary.transportClassification).toBe("virtual-host-control-delay");
  expect(summary.publishable).toBeTrue();
});

test("keeps multi-transport tails mixed instead of blaming WebResourceRequested", () => {
  const results = transports.map((transport) =>
    result(transport, 0, 500, transport === "actutum" || transport === "fork-web-resource" ? 6000 : 600),
  );
  expect(buildTransportSummary(results, 1).transportClassification).toBe("mixed-delay");
});
