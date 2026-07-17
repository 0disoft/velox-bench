import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkEnvironmentIdentity } from "./environment";

export const frameworks = ["velox", "wails", "neutralino", "tauri"] as const;
export type Framework = (typeof frameworks)[number];

export type Lock = {
  schemaVersion: "velox-bench-lock/v2";
  runner: "windows-2025";
  toolchains: Record<"bun" | "go" | "node" | "rust", string>;
  actions: Record<string, string>;
  fixture: { name: string; files: string[] };
  frameworks: Record<Framework, Record<string, string>>;
};

export type Result = {
  schemaVersion: "velox.bench-result/v1";
  suite: "zero-cache";
  framework: Framework;
  frameworkRevision: string;
  sample: number;
  fixtureSha256: string;
  outcome: "success" | "failure" | "timeout";
  startedAtUtc: string;
  finishedAtUtc: string;
  environment: BenchmarkEnvironmentIdentity & {
    bunVersion: string;
    repositoryCommit: string;
    runId: string;
    runAttempt: string;
  };
  measurement: null | {
    endToEndMs: number;
    frameworkSetupMs: number;
    buildMs: number;
    packageMs: number;
    acquisitionWorkingSetBytes: number;
    outputFiles: number;
    outputBytes: number;
    outputArchiveBytes: number;
    outputArchiveSha256: string;
    intermediateFiles: number;
    intermediateBytes: number;
    uploadedCacheBytes: 0;
    cacheEvidence: "workflow-source-audit";
  };
  failure: null | { phase: string; code: string };
};

export async function loadLock(root: string): Promise<Lock> {
  return JSON.parse(await readFile(join(root, "bench.lock.json"), "utf8")) as Lock;
}

export async function fixtureDigest(root: string, lock: Lock): Promise<string> {
  const digest = createHash("sha256");
  for (const file of lock.fixture.files) {
    digest.update(file);
    digest.update(await readFile(join(root, "fixtures", lock.fixture.name, file)));
  }
  return digest.digest("hex");
}

export function validateResult(value: unknown): asserts value is Result {
  if (!value || typeof value !== "object") throw new Error("result must be an object");
  const result = value as Partial<Result>;
  if (result.schemaVersion !== "velox.bench-result/v1" || result.suite !== "zero-cache") {
    throw new Error("unsupported result contract");
  }
  if (!frameworks.includes(result.framework as Framework)) throw new Error("unknown framework");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "")) throw new Error("invalid framework revision");
  if (!Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9) throw new Error("invalid sample");
  if (!/^[0-9a-f]{64}$/.test(result.fixtureSha256 ?? "")) throw new Error("invalid fixture digest");
  if (!result.outcome || !["success", "failure", "timeout"].includes(result.outcome)) throw new Error("invalid outcome");
  if (!result.startedAtUtc || !result.finishedAtUtc || !Number.isFinite(Date.parse(result.startedAtUtc)) || !Number.isFinite(Date.parse(result.finishedAtUtc))) {
    throw new Error("invalid timestamps");
  }
  const environment = result.environment;
  if (!environment || environment.runner !== "windows-2025" || environment.os !== "windows" || environment.architecture !== "amd64" || environment.bunVersion !== "1.3.14") {
    throw new Error("invalid environment");
  }
  if (!environment.runnerImageVersion || !environment.windowsVersion || !environment.cpuModel || !Number.isInteger(environment.logicalProcessors) || environment.logicalProcessors < 1 || !Number.isInteger(environment.memoryBytes) || environment.memoryBytes < 1) {
    throw new Error("incomplete environment");
  }
  if (result.outcome === "success") {
    if (!result.measurement || result.failure !== null) throw new Error("success result is incomplete");
    if (result.measurement.uploadedCacheBytes !== 0 || result.measurement.cacheEvidence !== "workflow-source-audit") {
      throw new Error("zero-cache evidence is invalid");
    }
    for (const field of ["endToEndMs", "frameworkSetupMs", "buildMs", "packageMs", "acquisitionWorkingSetBytes", "outputFiles", "outputBytes", "outputArchiveBytes", "intermediateFiles", "intermediateBytes"] as const) {
      if (!Number.isFinite(result.measurement[field]) || result.measurement[field] < 0) throw new Error(`invalid ${field}`);
    }
    if (result.measurement.outputFiles < 1 || result.measurement.outputBytes < 1 || result.measurement.outputArchiveBytes < 1) {
      throw new Error("successful result has no output");
    }
    if (!/^[0-9a-f]{64}$/.test(result.measurement.outputArchiveSha256)) throw new Error("invalid output digest");
  } else if (result.measurement !== null || !result.failure) {
    throw new Error("failed result is incomplete");
  } else if (!result.failure.phase || !/^[A-Z0-9_]+$/.test(result.failure.code)) {
    throw new Error("invalid failure");
  }
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) throw new Error("cannot summarize an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

export async function treeStats(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(path)).size;
      }
    }
  }
  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { files, bytes };
}
