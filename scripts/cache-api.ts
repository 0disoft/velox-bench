import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { frameworksForScope } from "./recommended-cache-contracts";

export type CacheRecord = { id: number; key: string; ref: string; sizeBytes: number; createdAtUtc: string };

type GitHubCache = { id?: unknown; key?: unknown; ref?: unknown; size_in_bytes?: unknown; created_at?: unknown };

export function exactCacheRecord(payload: unknown, key: string, ref: string): CacheRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("cache API payload must be an object");
  const entries = (payload as { actions_caches?: unknown }).actions_caches;
  if (!Array.isArray(entries)) throw new Error("cache API payload has no actions_caches array");
  const matches = entries.filter((entry): entry is GitHubCache => !!entry && typeof entry === "object" && (entry as GitHubCache).key === key && (entry as GitHubCache).ref === ref);
  if (matches.length !== 1) throw new Error(`expected one exact cache for ${key}, observed ${matches.length}`);
  const match = matches[0];
  if (!Number.isInteger(match.id) || (match.id as number) < 1 || !Number.isInteger(match.size_in_bytes) || (match.size_in_bytes as number) < 1 || typeof match.created_at !== "string" || !Number.isFinite(Date.parse(match.created_at))) throw new Error("cache API record is incomplete");
  return { id: match.id as number, key, ref, sizeBytes: match.size_in_bytes as number, createdAtUtc: match.created_at };
}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "velox-bench-cache-evidence",
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

function endpoint(owner: string, repository: string, key: string, ref: string): string {
  const query = new URLSearchParams({ key, ref, per_page: "100" });
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/caches?${query}`;
}

async function inspect(owner: string, repository: string, key: string, ref: string): Promise<CacheRecord> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(endpoint(owner, repository, key, ref), { headers: headers() });
    if (!response.ok) throw new Error(`cache API returned ${response.status}`);
    try {
      return exactCacheRecord(await response.json(), key, ref);
    } catch (error) {
      lastError = error;
      await Bun.sleep(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("cache did not become visible");
}

export function isDeleteSuccessStatus(status: number): boolean {
  return status === 200 || status === 204 || status === 404;
}

async function remove(owner: string, repository: string, key: string, ref: string): Promise<void> {
  const response = await fetch(endpoint(owner, repository, key, ref), { method: "DELETE", headers: headers() });
  if (!isDeleteSuccessStatus(response.status)) throw new Error(`cache delete returned ${response.status}`);
}

function cacheKey(runId: string, runAttempt: string, framework: string, sample: number): string {
  return `velox-bench-recommended-${runId}-${runAttempt}-${framework}-${sample}`;
}

export async function runCacheAPI(args: string[]): Promise<void> {
const [command, owner, repository, keyOrScope, refOrSamples, outputOrRunId, maybeAttempt, maybeRef] = args;
if (command === "inspect") {
  if (!owner || !repository || !keyOrScope || !refOrSamples || !outputOrRunId) throw new Error("usage: cache-api.ts inspect <owner> <repo> <key> <ref> <output>");
  const record = await inspect(owner, repository, keyOrScope, refOrSamples);
  await mkdir(dirname(resolve(outputOrRunId)), { recursive: true });
  await Bun.write(resolve(outputOrRunId), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
} else if (command === "delete-scope") {
  if (!owner || !repository || !keyOrScope || !refOrSamples || !outputOrRunId || !maybeAttempt || !maybeRef) throw new Error("usage: cache-api.ts delete-scope <owner> <repo> <scope> <samples> <run-id> <run-attempt> <ref>");
  const samples = Number(refOrSamples);
  if (!Number.isInteger(samples) || samples < 1 || samples > 3) throw new Error("sample count must be 1 or 3");
  const removed: string[] = [];
  for (const framework of frameworksForScope(keyOrScope)) {
    if (framework === "velox") continue;
    for (let sample = 0; sample < samples; sample++) {
      const key = cacheKey(outputOrRunId, maybeAttempt, framework, sample);
      await remove(owner, repository, key, maybeRef);
      removed.push(key);
    }
  }
  console.log(JSON.stringify({ removed }));
} else {
  throw new Error("cache-api command must be inspect or delete-scope");
}
}

if (import.meta.main) await runCacheAPI(process.argv.slice(2));
