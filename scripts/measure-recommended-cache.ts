import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fixtureIdentity, frameworks, loadLock, treeStats, type Framework } from "./contracts";
import { currentBenchmarkEnvironment } from "./environment";
import { resolveVeloxOutput } from "./framework-output";
import { recommendedCachePhases, type RecommendedCacheDraft, type RecommendedCachePhase } from "./recommended-cache-contracts";
import { createDeterministicZip } from "./zip";

const root = resolve(import.meta.dir, "..");
const framework = process.argv[2] as Framework;
const phaseName = process.argv[3] as RecommendedCachePhase;
const sample = Number(process.argv[4]);
const resultArgument = process.argv[5];
const clockArgument = process.argv[6];
if (!frameworks.includes(framework) || !recommendedCachePhases.includes(phaseName) || !Number.isInteger(sample) || sample < 0 || sample > 2 || !resultArgument || !clockArgument) {
  throw new Error("usage: measure-recommended-cache.ts <framework> <prime|warm> <sample> <draft-result> <clock>");
}

const resultPath = resolve(resultArgument);
const clockPath = resolve(clockArgument);
const cacheRoot = resolve(process.env.VELOX_BENCH_CACHE_ROOT || "");
if (!process.env.VELOX_BENCH_CACHE_ROOT) throw new Error("VELOX_BENCH_CACHE_ROOT is required");
const lock = await loadLock(root);
const fixture = await fixtureIdentity(root, lock, "hello");
const startedAtMs = Number(await readFile(clockPath, "utf8"));
if (!Number.isFinite(startedAtMs)) throw new Error("invalid benchmark start clock");

const work = join(root, ".bench", "recommended-cache", "work", `${framework}-${sample}-${phaseName}`);
const project = join(work, "project");
const tooling = join(work, "tooling");
let archive = join(work, `${framework}-${sample}-${phaseName}.zip`);
const deadlineMs = startedAtMs + 40 * 60 * 1000;
let failurePhase = "prepare";
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
  sourceBaseline = await treeStats(project);
}

async function measureVelox(): Promise<void> {
  const releaseRoot = process.env.VELOX_RELEASE_ROOT;
  if (!releaseRoot) throw new Error("VELOX_RELEASE_ROOT is required for Velox");
  const acquired = resolve(releaseRoot);
  const executables = await findFiles(acquired, (path) => basename(path).toLowerCase() === "velox.exe");
  if (executables.length !== 1) throw new Error("Velox release must contain exactly one velox.exe");
  await copyProject(join(root, "apps", "velox"));
  const output = join(work, "velox-output");
  buildMs = await timed(() => run([executables[0], "build", "--config", join(project, "velox.json"), "--out", output, "--json"], project));
  const resolvedOutput = await resolveVeloxOutput(output);
  portable = resolvedOutput.portable;
  archive = resolvedOutput.archive;
}

async function measureWails(): Promise<void> {
  await copyProject(join(root, "apps", "wails"));
  const env = { GOBIN: join(tooling, "bin"), GOMODCACHE: join(cacheRoot, "go-mod"), GOCACHE: join(cacheRoot, "go-build") };
  await mkdir(env.GOBIN, { recursive: true });
  setupMs = await timed(() => run(["go", "install", `github.com/wailsapp/wails/v2/cmd/wails@${lock.frameworks.wails.version}`], project, env));
  buildMs = await timed(() => run([join(env.GOBIN, "wails.exe"), "build", "-clean", "-platform", "windows/amd64"], project, env));
  portable = join(project, "build", "bin");
}

async function measureNeutralino(): Promise<void> {
  await copyProject(join(root, "apps", "neutralino"));
  const prefix = join(tooling, "neutralino");
  const env = { npm_config_cache: join(cacheRoot, "npm") };
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
  const cargoHome = join(cacheRoot, "cargo-home");
  const rustupHome = join(tooling, "rustup-home");
  const cliRoot = join(tooling, "tauri-cli");
  const target = join(cacheRoot, "tauri-target");
  const env = { CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome, RUSTUP_TOOLCHAIN: lock.toolchains.rust, CARGO_TARGET_DIR: target };
  setupMs = await timed(async () => {
    await run(["rustup", "toolchain", "install", lock.toolchains.rust, "--profile", "minimal", "--no-self-update"], work, env);
    await run(["cargo", `+${lock.toolchains.rust}`, "install", "tauri-cli", "--version", lock.frameworks.tauri.version.slice(1), "--locked", "--root", cliRoot], work, env);
  });
  buildMs = await timed(() => run([join(cliRoot, "bin", "cargo-tauri.exe"), "build", "--no-bundle"], join(project, "src-tauri"), env));
  const executable = join(target, "release", "velox-bench-tauri.exe");
  portable = join(work, "portable");
  await mkdir(portable, { recursive: true });
  await cp(executable, join(portable, basename(executable)));
}

let result: RecommendedCacheDraft;
try {
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  failurePhase = "framework-setup-and-build";
  if (framework === "velox") await measureVelox();
  else if (framework === "wails") await measureWails();
  else if (framework === "neutralino") await measureNeutralino();
  else await measureTauri();

  failurePhase = "package";
  if (framework !== "velox") packageMs = await timed(() => createDeterministicZip(portable, archive));
  const output = await treeStats(portable);
  const intermediate = await treeStats(work);
  const cacheStats = await treeStats(cacheRoot);
  const archiveData = await readFile(archive);
  const finishedAtMs = Date.now();
  result = {
    schemaVersion: "velox.recommended-cache-draft/v1",
    suite: "recommended-cache",
    phase: phaseName,
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
      cacheWorkingSetFiles: cacheStats.files,
      cacheWorkingSetBytes: cacheStats.bytes,
      outputFiles: output.files,
      outputBytes: output.bytes,
      outputArchiveBytes: archiveData.length,
      outputArchiveSha256: createHash("sha256").update(archiveData).digest("hex"),
      intermediateFiles: Math.max(0, intermediate.files - sourceBaseline.files - output.files - 1),
      intermediateBytes: Math.max(0, intermediate.bytes - sourceBaseline.bytes - output.bytes - archiveData.length),
    },
    failure: null,
  };
} catch (error) {
  const timedOut = error instanceof BenchmarkTimeout;
  result = {
    schemaVersion: "velox.recommended-cache-draft/v1",
    suite: "recommended-cache",
    phase: phaseName,
    framework,
    frameworkRevision: lock.frameworks[framework].commit,
    sample,
    fixture,
    outcome: timedOut ? "timeout" : "failure",
    startedAtUtc: new Date(startedAtMs).toISOString(),
    finishedAtUtc: new Date().toISOString(),
    environment: environment(),
    measurement: null,
    failure: { phase: failurePhase, code: timedOut ? "DEADLINE_EXCEEDED" : "PHASE_FAILED" },
  };
}

await mkdir(dirname(resultPath), { recursive: true });
await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outcome: result.outcome, framework, phase: phaseName, sample, resultPath }));
if (result.outcome !== "success") process.exit(1);
