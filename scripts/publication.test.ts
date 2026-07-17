import { expect, test } from "bun:test";
import { buildPairPublication, publicationEndMarker, publicationStartMarker, renderPairPublication, serializeCanonicalJson, updateReadmePublication, type RunMetadata } from "./publication";

function source() {
  const summary = {
    schemaVersion: "velox.bench-pair-summary/v1",
    suite: "zero-cache",
    scope: "velox-wails",
    expectedPerFramework: 10,
    fixtureSha256: "f".repeat(64),
    frameworkRevisions: { velox: "a".repeat(40), wails: "b".repeat(40) },
    uploadedCacheBytes: 0,
    environmentCount: 1,
    environments: [{ runner: "windows-2025", runnerImageVersion: "stable", os: "windows", architecture: "amd64", windowsVersion: "10.0", logicalProcessors: 4, memoryClassBytes: 16 * 1024 ** 3, bunVersion: "1.3.14", observed: 20 }],
    hardwareBalanced: true,
    hardwareVariants: [{ cpuModel: "CPU", observed: 20, frameworks: { velox: 10, wails: 10 } }],
    publishable: true,
    rows: [
      { framework: "velox", expected: 10, observed: 10, missing: 0, successful: 10, failed: 0, timedOut: 0, endToEndMs: { min: 90, p50: 100, p95: 120, max: 120 } },
      { framework: "wails", expected: 10, observed: 10, missing: 0, successful: 10, failed: 0, timedOut: 0, endToEndMs: { min: 350, p50: 400, p95: 500, max: 500 } },
    ],
  };
  const decision = {
    schemaVersion: "velox.bench-pair-decision/v1",
    suite: "zero-cache",
    scope: "velox-wails",
    evidenceLevel: "publishable",
    status: "passed",
    target: { metric: "wails-to-velox-p50-ratio", minimum: 3 },
    metrics: { veloxP50Ms: 100, wailsP50Ms: 400, wailsToVeloxP50Ratio: 4 },
    gates: { completeSuccessfulSamples: true, singleEnvironment: true, hardwareBalanced: true, zeroCacheUpload: true, minimumSpeedup: true },
    questionsRequired: false,
  };
  const metadata: RunMetadata = {
    schemaVersion: "velox.github-run-metadata/v1",
    repository: "0disoft/velox-bench",
    capturedAtUtc: "2026-07-17T00:11:00.000Z",
    run: { id: "123", attempt: 1, url: "https://github.com/0disoft/velox-bench/actions/runs/123", workflowName: "Zero-cache benchmark", event: "workflow_dispatch", headSha: "c".repeat(40), status: "completed", conclusion: "success", createdAtUtc: "2026-07-17T00:00:00.000Z", startedAtUtc: "2026-07-17T00:01:00.000Z", completedAtUtc: "2026-07-17T00:11:00.000Z" },
    jobs: [
      { id: "1", name: "contracts", status: "completed", conclusion: "success", startedAtUtc: "2026-07-17T00:01:00.000Z", completedAtUtc: "2026-07-17T00:02:00.000Z" },
      { id: "2", name: "measure", status: "completed", conclusion: "success", startedAtUtc: "2026-07-17T00:02:00.000Z", completedAtUtc: "2026-07-17T00:10:00.000Z" },
      { id: "3", name: "skipped", status: "completed", conclusion: "skipped", startedAtUtc: null, completedAtUtc: null },
    ],
    artifacts: [{ id: "4", name: "zero-cache-velox-wails-summary-123-1", sizeBytes: 2048, expired: false }],
  };
  return { summary, decision, metadata };
}

test("builds a deterministic public result and resource observation", () => {
  const { summary, decision, metadata } = source();
  const publication = buildPairPublication(summary, decision, metadata, { runId: "123", runAttempt: 1, benchmarkCommit: "c".repeat(40) });
  expect(publication.result.wailsToVeloxP50Ratio).toBe(4);
  expect(publication.resources.workflowWallMs).toBe(600_000);
  expect(publication.resources.aggregateJobRuntimeMs).toBe(540_000);
  expect(publication.resources.skippedJobs).toBe(1);
  expect(renderPairPublication(publication)).toContain("4.000x");
});

test("rejects a failed source run", () => {
  const { summary, decision, metadata } = source();
  metadata.run.conclusion = "failure";
  expect(() => buildPairPublication(summary, decision, metadata, { runId: "123", runAttempt: 1, benchmarkCommit: "c".repeat(40) })).toThrow("completed successful");
});

test("rejects a decision derived from different summary metrics", () => {
  const { summary, decision, metadata } = source();
  decision.metrics.wailsP50Ms = 401;
  expect(() => buildPairPublication(summary, decision, metadata, { runId: "123", runAttempt: 1, benchmarkCommit: "c".repeat(40) })).toThrow("does not match");
});

test("canonical source serialization is independent of input line endings", () => {
  const lf = '{\n  "value": 1\n}\n';
  const crlf = lf.replaceAll("\n", "\r\n");
  expect(serializeCanonicalJson(JSON.parse(lf))).toBe(serializeCanonicalJson(JSON.parse(crlf)));
  expect(serializeCanonicalJson(JSON.parse(crlf))).toBe(lf);
});

test("replaces one generated README block and rejects duplicate markers", () => {
  const { summary, decision, metadata } = source();
  const publication = buildPairPublication(summary, decision, metadata, { runId: "123", runAttempt: 1, benchmarkCommit: "c".repeat(40) });
  const readme = `before\n${publicationStartMarker}\nold\n${publicationEndMarker}\nafter\n`;
  const updated = updateReadmePublication(readme, renderPairPublication(publication));
  expect(updated).toContain("4.000x");
  expect(() => updateReadmePublication(`${readme}${publicationStartMarker}`, "x")).toThrow("unique");
  const crlf = readme.replaceAll("\n", "\r\n");
  const updatedCrlf = updateReadmePublication(crlf, renderPairPublication(publication));
  expect(updatedCrlf.replaceAll("\r\n", "")).not.toContain("\n");
});
