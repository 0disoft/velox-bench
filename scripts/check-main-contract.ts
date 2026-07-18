type WorkflowRun = {
  id: number;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url: string;
};

type WorkflowRunsResponse = {
  workflow_runs: WorkflowRun[];
};

const repository = process.env.ACTUTUM_BENCH_REPOSITORY ?? "0disoft/velox-bench";
const commit = process.argv[2] ?? currentCommit();
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`invalid benchmark commit: ${commit}`);

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "actutum-bench-main-contract",
  "X-GitHub-Api-Version": "2022-11-28",
};
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (token) headers.Authorization = `Bearer ${token}`;

const query = new URLSearchParams({ branch: "main", event: "push", head_sha: commit, per_page: "10" });
const response = await fetch(
  `https://api.github.com/repos/${repository}/actions/workflows/zero-cache.yml/runs?${query}`,
  { headers, signal: AbortSignal.timeout(15_000) },
);
if (!response.ok) throw new Error(`GitHub workflow API returned ${response.status} ${response.statusText}`);

const body = await response.json() as WorkflowRunsResponse;
const matches = body.workflow_runs.filter((run) => run.head_sha === commit && run.event === "push");
if (matches.length !== 1) {
  throw new Error(`expected one Zero-cache benchmark push run for ${commit}; found ${matches.length}`);
}
const run = matches[0];
if (run.status !== "completed" || run.conclusion !== "success") {
  throw new Error(`Zero-cache benchmark run ${run.id} is ${run.status}/${run.conclusion ?? "none"}: ${run.html_url}`);
}

console.log(JSON.stringify({
  ok: true,
  repository,
  commit,
  runId: run.id,
  workflow: run.name,
  status: run.status,
  conclusion: run.conclusion,
  url: run.html_url,
}, null, 2));

function currentCommit(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}
