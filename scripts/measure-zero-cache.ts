import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  fixtureIdentity,
  fixtureNames,
  frameworks,
  loadLock,
  treeStats,
  validateResult,
  type FixtureName,
  type Framework,
  type Result,
} from "./contracts";
import { currentBenchmarkEnvironment } from "./environment";
import { materializeAssetPackIntoProject } from "./fixture-materialization";
import { resolveActutumOutput } from "./framework-output";
import { createDeterministicZip } from "./zip";

const root = resolve(import.meta.dir, "..");
const framework = process.argv[2] as Framework;
const sample = Number(process.argv[3]);
const resultArgument = process.argv[4];
const clockArgument = process.argv[5];
if (!frameworks.includes(framework) || !Number.isInteger(sample) || !resultArgument || !clockArgument) {
  throw new Error("usage: measure-zero-cache.ts <framework> <sample> <result> <clock>");
}
const resultPath = resolve(resultArgument);
const clockPath = resolve(clockArgument);

const lock = await loadLock(root);
const fixtureName = (process.env.ACTUTUM_BENCH_FIXTURE || "hello") as FixtureName;
if (!fixtureNames.includes(fixtureName)) throw new Error("ACTUTUM_BENCH_FIXTURE must be hello or asset-pack");
const fixture = await fixtureIdentity(root, lock, fixtureName);
const assetPackRoot = fixtureName === "asset-pack" ? process.env.ACTUTUM_BENCH_ASSET_PACK_ROOT : undefined;
if (fixtureName === "asset-pack" && !assetPackRoot) throw new Error("ACTUTUM_BENCH_ASSET_PACK_ROOT is required for asset-pack");
const startedAtMs = Number(await readFile(clockPath, "utf8"));
if (!Number.isFinite(startedAtMs)) throw new Error("invalid benchmark start clock");
const work = join(root, ".bench", "work", `${framework}-${sample}`);
const project = join(work, "project");
const tooling = join(work, "tooling");
const cache = join(work, "cache");
let archive = join(work, `${framework}-${sample}.zip`);
const deadlineMs = startedAtMs + 40 * 60 * 1000;
let phase = "prepare";
let setupMs = 0;
let buildMs = 0;
let packageMs = 0;
let sourceBaseline = { files: 0, bytes: 0 };
let portable = "";

class BenchmarkTimeout extends Error {}

function environment() {
  return {
    ...currentBenchmarkEnvironment(),
    bunVersion: Bun.version,
    repositoryCommit: process.env.GITHUB_SHA || "local-unverified",
    runId: process.env.GITHUB_RUN_ID || "local-unverified",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local-unverified",
  };
}

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    child.kill();
    throw new BenchmarkTimeout("benchmark deadline exceeded");
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, remaining);
  const exitCode = await child.exited.finally(() => clearTimeout(timer));
  if (timedOut) throw new BenchmarkTimeout("benchmark deadline exceeded");
  if (exitCode !== 0) throw new Error(`command failed with exit code ${exitCode}`);
}

async function timed(task: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await task();
  return performance.now() - start;
}

async function findFiles(directory: string, predicate: (path: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && predicate(path)) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

async function copyProject(source: string): Promise<void> {
  await cp(source, project, { recursive: true });
  if (fixtureName === "asset-pack") {
    phase = "fixture-materialization";
    await materializeAssetPackIntoProject(project, framework, resolve(assetPackRoot!));
    phase = "framework-setup-and-build";
  }
  sourceBaseline = await treeStats(project);
}

async function measureActutum(): Promise<void> {
  const acquired = resolve(process.env.ACTUTUM_RELEASE_ROOT || "");
  const executables = await findFiles(acquired, (path) => basename(path).toLowerCase() === "actutum.exe");
  if (executables.length !== 1) throw new Error("Actutum release must contain exactly one actutum.exe");
  await copyProject(join(root, "apps", "actutum"));
  const output = join(work, "actutum-output");
  buildMs = await timed(() => run([executables[0], "build", "--config", join(project, "actutum.json"), "--out", output, "--json"], project));
  const resolvedOutput = await resolveActutumOutput(output);
  portable = resolvedOutput.portable;
  archive = resolvedOutput.archive;
}

async function measureWails(): Promise<void> {
  await copyProject(join(root, "apps", "wails"));
  const env = { GOBIN: join(tooling, "bin"), GOMODCACHE: join(cache, "go-mod"), GOCACHE: join(cache, "go-build") };
  await mkdir(env.GOBIN, { recursive: true });
  setupMs = await timed(() => run(["go", "install", `github.com/wailsapp/wails/v2/cmd/wails@${lock.frameworks.wails.version}`], project, env));
  buildMs = await timed(() => run([join(env.GOBIN, "wails.exe"), "build", "-clean", "-platform", "windows/amd64"], project, env));
  portable = join(project, "build", "bin");
}

async function measureNeutralino(): Promise<void> {
  await copyProject(join(root, "apps", "neutralino"));
  const prefix = join(tooling, "neutralino");
  const env = { npm_config_cache: join(cache, "npm") };
  setupMs = await timed(() => run(["npm.cmd", "install", "--prefix", prefix, `@neutralinojs/neu@${lock.frameworks.neutralino.cliVersion.slice(1)}`, "--no-audit", "--no-fund"], work, env));
  const neu = join(prefix, "node_modules", ".bin", "neu.cmd");
  buildMs = await timed(async () => {
    await run([neu, "update"], project, env);
    await run([neu, "build", "--release"], project, env);
  });
  portable = join(project, "dist");
}

async function measureTauri(): Promise<void> {
  await copyProject(join(root, "apps", "tauri"));
  const cargoHome = join(tooling, "cargo-home");
  const rustupHome = join(tooling, "rustup-home");
  const cliRoot = join(tooling, "tauri-cli");
  const target = join(work, "tauri-target");
  const env = {
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    RUSTUP_TOOLCHAIN: lock.toolchains.rust,
    CARGO_TARGET_DIR: target,
  };
  setupMs = await timed(async () => {
    await run(["rustup", "toolchain", "install", lock.toolchains.rust, "--profile", "minimal", "--no-self-update"], work, env);
    await run(["cargo", `+${lock.toolchains.rust}`, "install", "tauri-cli", "--version", lock.frameworks.tauri.version.slice(1), "--locked", "--root", cliRoot], work, env);
  });
  buildMs = await timed(() => run([join(cliRoot, "bin", "cargo-tauri.exe"), "build", "--no-bundle"], join(project, "src-tauri"), env));
  const executable = join(target, "release", "actutum-bench-tauri.exe");
  portable = join(work, "portable");
  await mkdir(portable, { recursive: true });
  await cp(executable, join(portable, basename(executable)));
}

let result: Result;
try {
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  phase = "framework-setup-and-build";
  if (framework === "actutum") await measureActutum();
  else if (framework === "wails") await measureWails();
  else if (framework === "neutralino") await measureNeutralino();
  else await measureTauri();

  phase = "package";
  if (framework !== "actutum") {
    packageMs = await timed(() => createDeterministicZip(portable, archive));
  }
  const output = await treeStats(portable);
  const intermediate = await treeStats(work);
  const toolingStats = await treeStats(tooling);
  const cacheStats = await treeStats(cache);
  const archiveData = await readFile(archive);
  const finishedAtMs = Date.now();
  result = {
    schemaVersion: "actutum.bench-result/v3",
    suite: "zero-cache",
    framework,
    frameworkRevision: lock.frameworks[framework].commit,
    sample,
    fixture,
    outcome: "success",
    startedAtUtc: new Date(startedAtMs).toISOString(),
    finishedAtUtc: new Date(finishedAtMs).toISOString(),
    environment: environment(),
    measurement: {
      endToEndMs: finishedAtMs - startedAtMs,
      frameworkSetupMs: setupMs,
      buildMs,
      packageMs,
      acquisitionWorkingSetBytes: toolingStats.bytes + cacheStats.bytes,
      outputFiles: output.files,
      outputBytes: output.bytes,
      outputArchiveBytes: archiveData.length,
      outputArchiveSha256: createHash("sha256").update(archiveData).digest("hex"),
      intermediateFiles: Math.max(0, intermediate.files - sourceBaseline.files - output.files - 1),
      intermediateBytes: Math.max(0, intermediate.bytes - sourceBaseline.bytes - output.bytes - archiveData.length),
      uploadedCacheBytes: 0,
      cacheEvidence: "workflow-source-audit",
    },
    failure: null,
  };
} catch (error) {
  const timedOut = error instanceof BenchmarkTimeout;
  result = {
    schemaVersion: "actutum.bench-result/v3",
    suite: "zero-cache",
    framework,
    frameworkRevision: lock.frameworks[framework].commit,
    sample,
    fixture,
    outcome: timedOut ? "timeout" : "failure",
    startedAtUtc: new Date(startedAtMs).toISOString(),
    finishedAtUtc: new Date().toISOString(),
    environment: environment(),
    measurement: null,
    failure: { phase, code: timedOut ? "DEADLINE_EXCEEDED" : "PHASE_FAILED" },
  };
}

validateResult(result);
await mkdir(dirname(resultPath), { recursive: true });
await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outcome: result.outcome, framework, sample, resultPath }));
if (result.outcome !== "success") process.exit(1);
