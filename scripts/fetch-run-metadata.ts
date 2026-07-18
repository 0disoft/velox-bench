import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { RunMetadata } from "./publication";
import { validateRunMetadata } from "./publication";

const [runId, outputPath] = process.argv.slice(2);
if (!runId || !/^\d+$/.test(runId) || !outputPath) {
  throw new Error("usage: bun scripts/fetch-run-metadata.ts <run-id> <output.json>");
}

const repository = "0disoft/actutum-bench";
const apiRoot = `https://api.github.com/repos/${repository}`;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "actutum-bench-publication",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (token) headers.Authorization = `Bearer ${token}`;

async function getJson(url: string): Promise<any> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status} ${url}`);
  return response.json();
}

async function collect(path: string, field: "jobs" | "artifacts"): Promise<any[]> {
  const values: any[] = [];
  for (let page = 1; ; page += 1) {
    const body = await getJson(`${apiRoot}${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const entries = body[field];
    if (!Array.isArray(entries)) throw new Error(`GitHub API response is missing ${field}`);
    values.push(...entries);
    if (entries.length < 100) return values;
  }
}

const [run, jobs, artifacts] = await Promise.all([
  getJson(`${apiRoot}/actions/runs/${runId}`),
  collect(`/actions/runs/${runId}/jobs?filter=all`, "jobs"),
  collect(`/actions/runs/${runId}/artifacts`, "artifacts"),
]);
const metadata: RunMetadata = {
  schemaVersion: "actutum.github-run-metadata/v2",
  repository,
  capturedAtUtc: new Date().toISOString(),
  run: {
    id: String(run.id),
    attempt: run.run_attempt,
    url: run.html_url,
    workflowName: run.name,
    event: run.event,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    createdAtUtc: run.created_at,
    startedAtUtc: run.run_started_at,
    completedAtUtc: run.updated_at,
  },
  jobs: jobs.map((job) => ({
    id: String(job.id),
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAtUtc: job.started_at,
    completedAtUtc: job.completed_at,
  })),
  artifacts: artifacts.map((artifact) => ({
    id: String(artifact.id),
    name: artifact.name,
    sizeBytes: artifact.size_in_bytes,
    expired: artifact.expired,
  })),
};
validateRunMetadata(metadata);
const target = resolve(outputPath);
await mkdir(dirname(target), { recursive: true });
await Bun.write(target, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, runId: metadata.run.id, jobs: metadata.jobs.length, artifacts: metadata.artifacts.length, output: target }));
