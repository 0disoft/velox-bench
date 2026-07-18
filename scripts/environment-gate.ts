import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fixtureIdentity, fixtureNames, frameworks, loadLock, validateResult, type FixtureName, type Framework, type Result } from "./contracts";
import { assertHostedEnvironment, currentBenchmarkEnvironment, environmentFingerprint } from "./environment";

const mode = process.argv[2];
const argument = process.argv[3];
if (!mode || !argument || !["capture", "verify", "verify-pair"].includes(mode)) {
  throw new Error("usage: environment-gate.ts capture <output-json> | verify <expected-fingerprint> <result-json> <framework> <sample> | verify-pair <expected-fingerprint> <result-directory> <sample>");
}

const environment = currentBenchmarkEnvironment();
assertHostedEnvironment(environment);
const fingerprint = environmentFingerprint(environment);

if (mode === "capture") {
  const output = resolve(argument);
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, `${JSON.stringify({ schemaVersion: "velox.bench-environment/v1", fingerprint, environment }, null, 2)}\n`);
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is unavailable");
  await appendFile(githubOutput, `fingerprint=${fingerprint}\n`, "utf8");
  console.log(JSON.stringify({ output, fingerprint, environment }));
} else {
  const fixtureName = (process.env.VELOX_BENCH_FIXTURE || "hello") as FixtureName;
  if (!fixtureNames.includes(fixtureName)) throw new Error("VELOX_BENCH_FIXTURE must be hello or asset-pack");
  if (mode === "verify-pair" && fixtureName !== "hello") throw new Error("paired Velox-Wails evidence is hello-only");
  if (!/^[0-9a-f]{64}$/.test(argument)) throw new Error("expected environment fingerprint is invalid");
  if (fingerprint !== argument) {
    const resultArgument = process.argv[4];
    const selectedFrameworks: Framework[] = mode === "verify-pair" ? ["velox", "wails"] : [process.argv[5] as Framework];
    const sample = Number(mode === "verify-pair" ? process.argv[5] : process.argv[6]);
    if (!resultArgument || selectedFrameworks.some((framework) => !frameworks.includes(framework)) || !Number.isInteger(sample) || sample < 0 || sample > 9) {
      throw new Error("environment mismatch result identity is invalid");
    }
    const root = resolve(import.meta.dir, "..");
    const lock = await loadLock(root);
    const now = new Date().toISOString();
    const fixture = await fixtureIdentity(root, lock, fixtureName);
    for (const framework of selectedFrameworks) {
      const result: Result = {
        schemaVersion: "velox.bench-result/v2",
        suite: "zero-cache",
        framework,
        frameworkRevision: lock.frameworks[framework].commit,
        sample,
        fixture,
        outcome: "failure",
        startedAtUtc: now,
        finishedAtUtc: now,
        environment: {
          ...environment,
          bunVersion: Bun.version,
          repositoryCommit: process.env.GITHUB_SHA || "local-unverified",
          runId: process.env.GITHUB_RUN_ID || "local-unverified",
          runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local-unverified",
        },
        measurement: null,
        failure: { phase: "environment-preflight", code: "BENCHMARK_ENVIRONMENT_MISMATCH" },
      };
      validateResult(result);
      const resultPath = mode === "verify-pair"
        ? resolve(resultArgument, `${framework}-${sample}.json`)
        : resolve(resultArgument);
      await mkdir(dirname(resultPath), { recursive: true });
      await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.error(JSON.stringify({ code: "BENCHMARK_ENVIRONMENT_MISMATCH", expected: argument, actual: fingerprint, environment }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, fingerprint, environment }));
}
