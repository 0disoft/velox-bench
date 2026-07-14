import { expect, test } from "bun:test";
import { startupSummarySchemaVersion, startupSuite, type StartupSummary } from "./startup-contracts";
import { buildStartupHistory, type StartupHistoryCandidate } from "./startup-history";

function summary(environmentKey = "runner|windows|webview|cpu|4|16000000000"): StartupSummary {
  return {
    schemaVersion: startupSummarySchemaVersion,
    suite: startupSuite,
    framework: "velox",
    expected: 3,
    observed: 3,
    missing: 0,
    successful: 3,
    failed: 0,
    timedOut: 0,
    publishable: false,
    evidenceLevels: ["hosted-pinned-source"],
    environmentGroups: [{ key: environmentKey, samples: 3 }],
    fresh: { minMs: 900, p50Ms: 950, p95Ms: 1000, maxMs: 1000 },
    warm: { minMs: 800, p50Ms: 850, p95Ms: 900, maxMs: 900 },
  };
}

function candidate(index: number, overrides: Partial<StartupHistoryCandidate> = {}): StartupHistoryCandidate {
  return {
    runId: String(1000 + index),
    runAttempt: 1,
    benchmarkCommit: index.toString(16).padStart(40, "0"),
    createdAtUtc: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
    summary: summary(),
    ...overrides,
  };
}

test("keeps the latest twelve history points", () => {
  const history = buildStartupHistory(Array.from({ length: 14 }, (_, index) => candidate(index)), [], "2026-07-20T00:00:00.000Z");
  expect(history.points).toHaveLength(12);
  expect(history.points[0].runId).toBe("1002");
  expect(history.points[11].runId).toBe("1013");
});

test("keeps the newest attempt for one run", () => {
  const history = buildStartupHistory([candidate(0), candidate(0, { runAttempt: 2 })], [], "2026-07-20T00:00:00.000Z");
  expect(history.points).toHaveLength(1);
  expect(history.points[0].runAttempt).toBe(2);
});

test("separates history series by environment", () => {
  const history = buildStartupHistory([
    candidate(0),
    candidate(1, { summary: summary("runner-2|windows|webview|cpu|4|16000000000") }),
  ], [], "2026-07-20T00:00:00.000Z");
  expect(history.series).toHaveLength(2);
});

test("preserves collection issues as partial evidence", () => {
  const history = buildStartupHistory([candidate(0)], [{ runId: "999", code: "ARTIFACT_MISSING" }], "2026-07-20T00:00:00.000Z");
  expect(history.outcome).toBe("partial");
  expect(history.collectionIssues).toEqual([{ runId: "999", code: "ARTIFACT_MISSING" }]);
});
