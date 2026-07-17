import { expect, test } from "bun:test";
import { assertHostedEnvironment, environmentFingerprint, environmentKey, type BenchmarkEnvironmentIdentity } from "./environment";

function environment(overrides: Partial<BenchmarkEnvironmentIdentity> = {}): BenchmarkEnvironmentIdentity {
  return {
    runner: "windows-2025",
    runnerImageVersion: "20260714.173.1",
    os: "windows",
    architecture: "amd64",
    windowsVersion: "10.0.26100",
    cpuModel: "AMD EPYC",
    logicalProcessors: 4,
    memoryBytes: 16_000_000_000,
    ...overrides,
  };
}

test("stable hosted environment produces a stable fingerprint", () => {
  const first = environment();
  expect(environmentKey(first)).toBe(environmentKey({ ...first }));
  expect(environmentFingerprint(first)).toBe(environmentFingerprint({ ...first }));
  expect(() => assertHostedEnvironment(first)).not.toThrow();
});

test("runner image and CPU changes produce different fingerprints", () => {
  const baseline = environment();
  expect(environmentFingerprint(environment({ runnerImageVersion: "20260715.1" }))).not.toBe(environmentFingerprint(baseline));
  expect(environmentFingerprint(environment({ cpuModel: "Intel Xeon" }))).not.toBe(environmentFingerprint(baseline));
});

test("hosted capture rejects missing image evidence", () => {
  expect(() => assertHostedEnvironment(environment({ runnerImageVersion: "local-unverified" }))).toThrow("image version");
});

