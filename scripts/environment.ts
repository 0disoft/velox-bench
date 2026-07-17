import { createHash } from "node:crypto";
import { cpus, release, totalmem } from "node:os";

export type BenchmarkEnvironmentIdentity = {
  runner: "windows-2025";
  runnerImageVersion: string;
  os: "windows";
  architecture: "amd64";
  windowsVersion: string;
  cpuModel: string;
  logicalProcessors: number;
  memoryBytes: number;
};

export type ComparableEnvironmentIdentity = Omit<BenchmarkEnvironmentIdentity, "cpuModel" | "memoryBytes"> & {
  memoryClassBytes: number;
};

const gibibyte = 1024 ** 3;

export function currentBenchmarkEnvironment(): BenchmarkEnvironmentIdentity {
  const processors = cpus();
  return {
    runner: "windows-2025",
    runnerImageVersion: process.env.ImageVersion || "local-unverified",
    os: "windows",
    architecture: "amd64",
    windowsVersion: release(),
    cpuModel: processors[0]?.model.trim().replace(/\s+/g, " ") || "unverified",
    logicalProcessors: processors.length,
    memoryBytes: totalmem(),
  };
}

export function comparableEnvironment(environment: BenchmarkEnvironmentIdentity): ComparableEnvironmentIdentity {
  return {
    runner: environment.runner,
    runnerImageVersion: environment.runnerImageVersion,
    os: environment.os,
    architecture: environment.architecture,
    windowsVersion: environment.windowsVersion,
    logicalProcessors: environment.logicalProcessors,
    memoryClassBytes: Math.max(gibibyte, Math.round(environment.memoryBytes / gibibyte) * gibibyte),
  };
}

export function environmentKey(environment: ComparableEnvironmentIdentity): string {
  return [
    environment.runner,
    environment.runnerImageVersion,
    environment.os,
    environment.architecture,
    environment.windowsVersion,
    environment.logicalProcessors,
    environment.memoryClassBytes,
  ].join("|");
}

export function environmentFingerprint(environment: BenchmarkEnvironmentIdentity): string {
  return createHash("sha256").update(environmentKey(comparableEnvironment(environment))).digest("hex");
}

export function assertHostedEnvironment(environment: BenchmarkEnvironmentIdentity): void {
  if (environment.runnerImageVersion === "local-unverified") throw new Error("hosted runner image version is unavailable");
  if (environment.cpuModel === "unverified") throw new Error("hosted runner CPU model is unavailable");
  if (environment.logicalProcessors < 1 || environment.memoryBytes < 1) throw new Error("hosted runner resources are invalid");
}
