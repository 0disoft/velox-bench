import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateStartupSummary, type StartupSummary } from "./startup-contracts";
import { buildStartupHistory, maximumHistoryPoints, type StartupHistoryCandidate, type StartupHistoryIssue } from "./startup-history";

const outputArgument = process.argv[2];
if (!outputArgument) throw new Error("usage: collect-startup-history.ts <output>");
const output = resolve(outputArgument);
const repository = process.env.GITHUB_REPOSITORY ?? "";
const currentRunId = process.env.GITHUB_RUN_ID ?? "";
const currentAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
const currentCommit = process.env.GITHUB_SHA ?? "";
if (!/^[^/]+\/[^/]+$/.test(repository) || !/^[0-9]+$/.test(currentRunId) || !Number.isInteger(currentAttempt) ||
    currentAttempt < 1 || !/^[0-9a-f]{40}$/.test(currentCommit) || !process.env.GH_TOKEN) {
  throw new Error("startup history requires GitHub Actions repository, run, commit, and token context");
}

type WorkflowRun = {
  id: number;
  run_attempt: number;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
};

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const exitCode = await child.exited;
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`command failed with exit code ${exitCode}: ${stderr.slice(-500)}`);
  return stdout;
}

async function findSummary(directory: string): Promise<string> {
  const matches: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name === "startup.json") matches.push(path);
    }
  }
  await walk(directory);
  if (matches.length !== 1) throw new Error("downloaded artifact must contain exactly one startup.json");
  return matches[0];
}

const api = `repos/${repository}/actions/workflows/actutum-startup.yml/runs?branch=main&per_page=30`;
const response = JSON.parse(await run(["gh", "api", api], process.cwd())) as { workflow_runs?: WorkflowRun[] };
const completed = (response.workflow_runs ?? []).filter((candidate) => candidate.event === "workflow_dispatch" && candidate.head_branch === "main" &&
  candidate.status === "completed" && candidate.conclusion === "success");
const currentFromAPI = (response.workflow_runs ?? []).find((candidate) => String(candidate.id) === currentRunId);
const current: WorkflowRun = currentFromAPI ?? {
  id: Number(currentRunId), run_attempt: currentAttempt, head_sha: currentCommit, head_branch: "main", event: "workflow_dispatch",
  status: "in_progress", conclusion: null, created_at: new Date().toISOString(),
};
const runs = [current, ...completed.filter((candidate) => String(candidate.id) !== currentRunId)]
  .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
  .slice(0, maximumHistoryPoints);

const downloadRoot = resolve(dirname(output), "downloads");
await rm(downloadRoot, { recursive: true, force: true });
await mkdir(downloadRoot, { recursive: true });
const candidates: StartupHistoryCandidate[] = [];
const issues: StartupHistoryIssue[] = [];
for (const candidate of runs) {
  const runId = String(candidate.id);
  const destination = join(downloadRoot, runId);
  await mkdir(destination, { recursive: true });
  const artifact = `startup-summary-${runId}-${candidate.run_attempt}`;
  try {
    await run(["gh", "run", "download", runId, "--repo", repository, "--name", artifact, "--dir", destination], process.cwd());
  } catch {
    issues.push({ runId, code: runId === currentRunId ? "ARTIFACT_DOWNLOAD_FAILED" : "ARTIFACT_MISSING" });
    continue;
  }
  try {
    const summary = JSON.parse(await readFile(await findSummary(destination), "utf8")) as StartupSummary;
    validateStartupSummary(summary);
    candidates.push({
      runId,
      runAttempt: candidate.run_attempt,
      benchmarkCommit: candidate.head_sha,
      createdAtUtc: candidate.created_at,
      summary,
    });
  } catch {
    issues.push({ runId, code: "SUMMARY_INVALID" });
  }
}

const history = buildStartupHistory(candidates, issues, new Date().toISOString());
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify({ output, points: history.points.length, series: history.series.length, outcome: history.outcome }));
if (!history.points.some((point) => point.runId === currentRunId)) process.exit(1);
