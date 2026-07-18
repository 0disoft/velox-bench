import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadAssetPackManifest } from "./asset-pack";
import type { BenchmarkEnvironmentIdentity } from "./environment";

export const frameworks = ["actutum", "wails", "neutralino", "tauri"] as const;
export type Framework = (typeof frameworks)[number];
export const fixtureNames = ["hello", "asset-pack"] as const;
export type FixtureName = (typeof fixtureNames)[number];

export type FixtureIdentity = {
  name: FixtureName;
  sha256: string;
  generatedFiles: number;
  generatedBytes: number;
};

export type Lock = {
  schemaVersion: "actutum-bench-lock/v3";
  runner: "windows-2025";
  toolchains: Record<"bun" | "go" | "node" | "rust", string>;
  actions: Record<string, string>;
  fixture: { name: string; files: string[] };
  assetPack: { manifest: string; expectedTreeSha256: string };
  frameworks: Record<Framework, Record<string, string>>;
};

export type Result = {
  schemaVersion: "actutum.bench-result/v3";
  suite: "zero-cache";
  framework: Framework;
  frameworkRevision: string;
  sample: number;
  fixture: FixtureIdentity;
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

export async function fixtureIdentity(root: string, lock: Lock, name: FixtureName): Promise<FixtureIdentity> {
  const helloSha256 = await fixtureDigest(root, lock);
  if (name === "hello") {
    return { name, sha256: helloSha256, generatedFiles: 0, generatedBytes: 0 };
  }

  const manifest = await loadAssetPackManifest(join(root, lock.assetPack.manifest));
  const digest = createHash("sha256");
  for (const value of ["actutum.fixture/v1", "hello", helloSha256, "asset-pack", lock.assetPack.expectedTreeSha256]) {
    digest.update(value, "utf8");
    digest.update(new Uint8Array([0]));
  }
  return {
    name,
    sha256: digest.digest("hex"),
    generatedFiles: manifest.layout.fileCount,
    generatedBytes: manifest.layout.totalBytes,
  };
}

export function validateFixtureIdentity(value: unknown): asserts value is FixtureIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fixture identity must be an object");
  const fixture = value as Partial<FixtureIdentity>;
  const keys = Object.keys(fixture).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["generatedBytes", "generatedFiles", "name", "sha256"])) {
    throw new Error("fixture identity keys are invalid");
  }
  if (!fixtureNames.includes(fixture.name as FixtureName)) throw new Error("unknown fixture");
  if (!/^[0-9a-f]{64}$/.test(fixture.sha256 ?? "")) throw new Error("invalid fixture digest");
  const expected = fixture.name === "hello"
    ? { generatedFiles: 0, generatedBytes: 0 }
    : { generatedFiles: 1000, generatedBytes: 10 * 1024 * 1024 };
  if (fixture.generatedFiles !== expected.generatedFiles || fixture.generatedBytes !== expected.generatedBytes) {
    throw new Error("fixture generated-size contract is invalid");
  }
}

export function validateResult(value: unknown): asserts value is Result {
  if (!value || typeof value !== "object") throw new Error("result must be an object");
  const result = value as Partial<Result>;
  if (result.schemaVersion !== "actutum.bench-result/v3" || result.suite !== "zero-cache") {
    throw new Error("unsupported result contract");
  }
  if (!frameworks.includes(result.framework as Framework)) throw new Error("unknown framework");
  if (!/^[0-9a-f]{40}$/.test(result.frameworkRevision ?? "")) throw new Error("invalid framework revision");
  if (!Number.isInteger(result.sample) || (result.sample ?? -1) < 0 || (result.sample ?? 10) > 9) throw new Error("invalid sample");
  validateFixtureIdentity(result.fixture);
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
