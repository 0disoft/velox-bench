import { readdir } from "node:fs/promises";
import { join } from "node:path";

type Pin = { repository: string; sha: string; version: string; locations: string[] };
type GitObject = { sha: string; type: string };

const workflowRoot = join(process.cwd(), ".github", "workflows");
const usePattern = /^\s*(?:-\s*)?uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[A-Za-z0-9_./-]+)?@([0-9a-f]{40})\s+#\s*(v[0-9][A-Za-z0-9_.-]*)\s*$/;
const pins = new Map<string, Pin>();

for (const entry of await readdir(workflowRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
  const lines = (await Bun.file(join(workflowRoot, entry.name)).text()).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes("uses:") || line.includes("uses: ./")) continue;
    const match = line.match(usePattern);
    if (!match) throw new Error(`${entry.name}:${index + 1} must use a 40-character SHA and version comment`);
    const location = `${entry.name}:${index + 1}`;
    const current = pins.get(match[1]);
    if (current && (current.sha !== match[2] || current.version !== match[3])) {
      throw new Error(`${match[1]} uses inconsistent pins at ${[...current.locations, location].join(", ")}`);
    }
    pins.set(match[1], {
      repository: match[1],
      sha: match[2],
      version: match[3],
      locations: [...(current?.locations ?? []), location],
    });
  }
}
if (pins.size === 0) throw new Error("no external workflow actions found");

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "velox-bench-action-pins",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function github<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status} ${response.statusText}`);
  return await response.json() as T;
}

for (const pin of [...pins.values()].sort((left, right) => left.repository.localeCompare(right.repository))) {
  const release = await github<{ tag_name: string }>(`/repos/${pin.repository}/releases/latest`);
  if (release.tag_name !== pin.version) {
    throw new Error(`${pin.repository} is pinned to ${pin.version}; latest stable release is ${release.tag_name}`);
  }
  const reference = await github<{ object: GitObject }>(`/repos/${pin.repository}/git/ref/tags/${encodeURIComponent(pin.version)}`);
  let object = reference.object;
  if (object.type === "tag") object = (await github<{ object: GitObject }>(`/repos/${pin.repository}/git/tags/${object.sha}`)).object;
  if (object.type !== "commit" || object.sha.toLowerCase() !== pin.sha.toLowerCase()) {
    throw new Error(`${pin.repository} ${pin.version} resolves to ${object.type}:${object.sha}; workflow pins ${pin.sha}`);
  }
  console.log(`verified ${pin.repository} ${pin.version} ${pin.sha} (${pin.locations.length} use sites)`);
}
