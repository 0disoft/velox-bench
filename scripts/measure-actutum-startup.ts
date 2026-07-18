import { randomUUID } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { createServer } from "node:net";
import { cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fixtureDigest, loadLock } from "./contracts";
import {
  readyBoundary,
  parseHostTimelineOutput,
  startupSchemaVersion,
  startupSuite,
  validateStartupResult,
  warmupCount,
  type StartupEnvironment,
  type StartupLaunch,
  type StartupResult,
} from "./startup-contracts";

const root = resolve(import.meta.dir, "..");
const sample = Number(process.argv[2]);
const releaseArgument = process.argv[3];
const resultArgument = process.argv[4];
if (!Number.isInteger(sample) || sample < 0 || sample > 9 || !releaseArgument || !resultArgument) {
  throw new Error("usage: measure-actutum-startup.ts <sample> <release-root> <result>");
}

const releaseRoot = resolve(releaseArgument);
const resultPath = resolve(resultArgument);
const work = join(root, ".bench", "startup", String(sample));
const project = join(work, "project");
const output = join(work, "output");
const profiles = join(work, "profiles");
const deadlineMs = Date.now() + 12 * 60 * 1000;
let phase = "prepare";
let webView2Version = "unavailable";

class StartupTimeout extends Error {}

function remainingMs(maximum: number): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new StartupTimeout("startup benchmark deadline exceeded");
  return Math.min(maximum, remaining);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new StartupTimeout(message)), remainingMs(milliseconds));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function findFiles(directory: string, filename: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let exitCode: number;
  try {
    exitCode = await withTimeout(child.exited, 5 * 60 * 1000, `command timed out: ${basename(command[0])}`);
  } catch (error) {
    child.kill();
    throw error;
  }
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`command failed with exit code ${exitCode}: ${stderr.slice(-1000)}`);
  return { stdout, stderr };
}

function startupEnvironment(): StartupEnvironment {
  const processors = cpus();
  return {
    runner: "windows-2025",
    runnerImageVersion: process.env.ImageVersion || "local-unverified",
    windowsVersion: release(),
    cpuModel: processors[0]?.model || "unverified",
    logicalProcessors: processors.length,
    memoryBytes: totalmem(),
    bunVersion: Bun.version,
    repositoryCommit: process.env.GITHUB_SHA || "local-unverified",
    runId: process.env.GITHUB_RUN_ID || "local-unverified",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local-unverified",
    webView2Version,
  };
}

function milliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function webViewVersionFromDoctor(stdout: string): string {
  const envelope = JSON.parse(stdout) as { ok?: boolean; result?: { checks?: Array<{ name?: string; status?: string; actual?: string }> } };
  const check = envelope.result?.checks?.find((candidate) => candidate.name === "webview2");
  if (envelope.ok !== true || check?.status !== "pass" || !check.actual) throw new Error("Actutum doctor did not report an installed WebView2 runtime");
  return check.actual;
}

async function hostFromBuildResult(outputRoot: string): Promise<{ host: string; config: string }> {
  const reports = await findFiles(outputRoot, "build-result.json");
  if (reports.length !== 1) throw new Error("Actutum build must contain exactly one build-result.json");
  const portable = dirname(reports[0]);
  const report = JSON.parse(await readFile(reports[0], "utf8")) as { schemaVersion?: string; host?: { file?: string } };
  const hostFile = report.host?.file;
  if (report.schemaVersion !== "actutum.build-result/v1" || !hostFile || isAbsolute(hostFile) || normalize(hostFile) !== basename(hostFile)) {
    throw new Error("Actutum build result contains an invalid host path");
  }
  const host = resolve(portable, hostFile);
  if (!host.startsWith(`${resolve(portable)}${sep}`)) throw new Error("Actutum build host escapes the portable directory");
  return { host, config: join(portable, "actutum.runtime.json") };
}

async function waitForProcessExit(processId: number): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < remainingMs(15_000)) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || code === "EINVAL") return;
      if (code !== "EPERM") throw error;
    }
    await Bun.sleep(25);
  }
  throw new StartupTimeout(`WebView2 browser process ${processId} did not exit`);
}

async function waitForProfileRelease(profile: string): Promise<void> {
  const probe = `${profile}.release-probe`;
  await rm(probe, { recursive: true, force: true });
  const started = performance.now();
  while (performance.now() - started < remainingMs(15_000)) {
    try {
      await rename(profile, probe);
      await rename(probe, profile);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EACCES", "EPERM", "EBUSY"].includes(code)) throw error;
      await Bun.sleep(25);
    }
  }
  throw new StartupTimeout("WebView2 user-data folder remained locked");
}

async function runHost(host: string, config: string, profile: string): Promise<StartupLaunch> {
  const pipePath = `\\\\.\\pipe\\actutum-bench-${process.pid}-${randomUUID()}`;
  let markerResolve!: (value: { receivedAt: number; browserProcessId: number }) => void;
  let markerReject!: (reason: unknown) => void;
  const marker = new Promise<{ receivedAt: number; browserProcessId: number }>((resolvePromise, rejectPromise) => {
    markerResolve = resolvePromise;
    markerReject = rejectPromise;
  });
  const server = createServer((socket) => {
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      body += chunk;
      const newline = body.indexOf("\n");
      if (newline < 0) return;
      const match = /^ready dom-2raf ([1-9][0-9]*)$/.exec(body.slice(0, newline).trim());
      if (!match) markerReject(new Error("invalid Actutum ready marker"));
      else markerResolve({ receivedAt: performance.now(), browserProcessId: Number(match[1]) });
      socket.end();
    });
    socket.on("error", markerReject);
  });
  server.on("error", markerReject);
  await withTimeout(new Promise<void>((resolvePromise) => server.listen(pipePath, resolvePromise)), 5_000, "named pipe did not start");

  const startedAt = performance.now();
  const child = Bun.spawn([host, "--config", config], {
    cwd: dirname(host),
    env: { ...process.env, ACTUTUM_BENCH_PIPE: pipePath, ACTUTUM_BENCH_EXIT_AFTER_READY: "1", ACTUTUM_DATA_DIR: profile },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const ready = await withTimeout(marker, 15_000, "Actutum did not report ready");
    const readyMs = ready.receivedAt - startedAt;
    const exitCode = await withTimeout(child.exited, 5_000, "Actutum host did not exit after ready");
    const hostExitedAt = performance.now();
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (exitCode !== 0) throw new Error(`Actutum host exited with ${exitCode}: ${(stderr || stdout).slice(-1000)}`);
    const hostTimeline = parseHostTimelineOutput(stderr, readyMs);
    await waitForProcessExit(ready.browserProcessId);
    const browserExitedAt = performance.now();
    await waitForProfileRelease(profile);
    const profileReleasedAt = performance.now();
    return {
      readyMs: milliseconds(readyMs),
      hostExitAfterReadyMs: milliseconds(hostExitedAt - ready.receivedAt),
      browserExitAfterHostMs: milliseconds(browserExitedAt - hostExitedAt),
      profileReleaseAfterHostMs: milliseconds(profileReleasedAt - hostExitedAt),
      browserProcessId: ready.browserProcessId,
      hostTimeline,
    };
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  }
}

const lock = await loadLock(root);
const startedAt = new Date();
let result: StartupResult;
try {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("startup benchmark requires Windows x64");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const executables = await findFiles(releaseRoot, "actutum.exe");
  if (executables.length !== 1) throw new Error("Actutum release must contain exactly one actutum.exe");
  const actutum = executables[0];

  phase = "build-fixture";
  await cp(join(root, "apps", "actutum"), project, { recursive: true });
  await run([actutum, "build", "--config", join(project, "actutum.json"), "--out", output, "--json"], project);
  const { host, config } = await hostFromBuildResult(output);

  phase = "inspect-runtime";
  const doctor = await run([actutum, "doctor", "--config", join(project, "actutum.json"), "--out", output, "--json"], project);
  webView2Version = webViewVersionFromDoctor(doctor.stdout);

  phase = "fresh-profile";
  const freshProfile = join(profiles, "fresh");
  await rm(freshProfile, { recursive: true, force: true });
  await mkdir(profiles, { recursive: true });
  const fresh = await runHost(host, config, freshProfile);

  phase = "warm-profile";
  const warmProfile = join(profiles, "warm");
  await rm(warmProfile, { recursive: true, force: true });
  for (let index = 0; index < warmupCount; index++) await runHost(host, config, warmProfile);
  const warm = await runHost(host, config, warmProfile);

  result = {
    schemaVersion: startupSchemaVersion,
    suite: startupSuite,
    framework: "actutum",
    frameworkRevision: lock.frameworks.actutum.commit,
    evidenceLevel: process.env.ACTUTUM_STARTUP_EVIDENCE_LEVEL === "hosted-pinned-source" ? "hosted-pinned-source" : "local-unverified-release",
    sample,
    fixtureSha256: await fixtureDigest(root, lock),
    outcome: "success",
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: new Date().toISOString(),
    environment: startupEnvironment(),
    measurement: { readyBoundary, warmupCount, fresh, warm },
    failure: null,
  };
} catch (error) {
  const diagnostic = (error instanceof Error ? error.message : "unknown startup benchmark failure")
    .replaceAll(root, "<benchmark-root>")
    .replaceAll(releaseRoot, "<release-root>")
    .slice(0, 1000);
  console.error(JSON.stringify({ phase, diagnostic }));
  result = {
    schemaVersion: startupSchemaVersion,
    suite: startupSuite,
    framework: "actutum",
    frameworkRevision: lock.frameworks.actutum.commit,
    evidenceLevel: process.env.ACTUTUM_STARTUP_EVIDENCE_LEVEL === "hosted-pinned-source" ? "hosted-pinned-source" : "local-unverified-release",
    sample,
    fixtureSha256: await fixtureDigest(root, lock),
    outcome: error instanceof StartupTimeout ? "timeout" : "failure",
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: new Date().toISOString(),
    environment: startupEnvironment(),
    measurement: null,
    failure: { phase, code: error instanceof StartupTimeout ? "DEADLINE_EXCEEDED" : "PHASE_FAILED" },
  };
}

validateStartupResult(result);
await mkdir(dirname(resultPath), { recursive: true });
await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outcome: result.outcome, sample, resultPath }));
if (result.outcome !== "success") process.exit(1);
