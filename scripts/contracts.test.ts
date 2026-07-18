import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { percentile, validateResult, type Result } from "./contracts";
import { createDeterministicZip } from "./zip";

function result(): Result {
  return {
    schemaVersion: "velox.bench-result/v2",
    suite: "zero-cache",
    framework: "velox",
    frameworkRevision: "a".repeat(40),
    sample: 0,
    fixture: { name: "hello", sha256: "b".repeat(64), generatedFiles: 0, generatedBytes: 0 },
    outcome: "success",
    startedAtUtc: "2026-07-13T00:00:00.000Z",
    finishedAtUtc: "2026-07-13T00:00:01.000Z",
    environment: { runner: "windows-2025", runnerImageVersion: "x", os: "windows", architecture: "amd64", windowsVersion: "10.0", cpuModel: "test", logicalProcessors: 2, memoryBytes: 1024, bunVersion: "1.3.14", repositoryCommit: "c", runId: "1", runAttempt: "1" },
    measurement: { endToEndMs: 1000, frameworkSetupMs: 1, buildMs: 2, packageMs: 3, acquisitionWorkingSetBytes: 4, outputFiles: 1, outputBytes: 5, outputArchiveBytes: 6, outputArchiveSha256: "c".repeat(64), intermediateFiles: 0, intermediateBytes: 0, uploadedCacheBytes: 0, cacheEvidence: "workflow-source-audit" },
    failure: null,
  };
}

describe("benchmark result contract", () => {
  test("accepts a complete zero-cache success", () => expect(() => validateResult(result())).not.toThrow());
  test("rejects a cache upload", () => {
    const candidate = result() as Result & { measurement: NonNullable<Result["measurement"]> & { uploadedCacheBytes: number } };
    candidate.measurement.uploadedCacheBytes = 1;
    expect(() => validateResult(candidate)).toThrow("zero-cache evidence");
  });
  test("rejects fixture metadata that disagrees with its name", () => {
    const candidate = result();
    candidate.fixture = { name: "asset-pack", sha256: "b".repeat(64), generatedFiles: 0, generatedBytes: 0 };
    expect(() => validateResult(candidate)).toThrow("generated-size contract");
  });
  test("uses nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
  });
});

test("deterministic zip bytes do not depend on source mtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "velox-bench-zip-"));
  const source = join(root, "source");
  await Bun.write(join(source, "b.txt"), "b");
  await Bun.write(join(source, "a.txt"), "a");
  const first = join(root, "first.zip");
  const second = join(root, "second.zip");
  await createDeterministicZip(source, first);
  await createDeterministicZip(source, second);
  expect(await readFile(first)).toEqual(await readFile(second));
});
