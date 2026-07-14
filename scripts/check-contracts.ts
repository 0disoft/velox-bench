import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTauriIcon } from "./tauri-icon";

type Lock = {
  schemaVersion: string;
  runner: string;
  toolchains: Record<string, string>;
  actions: Record<string, string>;
  fixture: { name: string; files: string[] };
  frameworks: Record<string, Record<string, string>>;
};

const root = join(import.meta.dir, "..");
const lock = JSON.parse(await readFile(join(root, "bench.lock.json"), "utf8")) as Lock;

function assertExactKeys(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys differ from the pinned Velox manifest v1 contract`);
  }
}

if (lock.schemaVersion !== "velox-bench-lock/v2" || lock.runner !== "windows-2025") {
  throw new Error("unsupported benchmark lock contract");
}
if (JSON.stringify(Object.keys(lock.frameworks).sort()) !== JSON.stringify(["neutralino", "tauri", "velox", "wails"])) {
  throw new Error("framework lock must contain exactly neutralino, tauri, velox, and wails");
}

const commitPattern = /^[0-9a-f]{40}$/;
const exactVersionPattern = /^\d+\.\d+\.\d+$/;
for (const [name, value] of Object.entries(lock.actions)) {
  if (!commitPattern.test(value)) {
    throw new Error(`actions.${name} is not an immutable commit`);
  }
}
for (const [name, value] of Object.entries(lock.toolchains)) {
  if (!exactVersionPattern.test(value)) {
    throw new Error(`toolchains.${name} is not an exact version`);
  }
}
for (const [framework, values] of Object.entries(lock.frameworks)) {
  for (const [name, value] of Object.entries(values)) {
    if (name.toLowerCase().includes("commit") && !commitPattern.test(value)) {
      throw new Error(`${framework}.${name} is not an immutable commit`);
    }
    if (name.toLowerCase().includes("version") && !/^v\d+\.\d+\.\d+$/.test(value)) {
      throw new Error(`${framework}.${name} is not an exact release version`);
    }
  }
}

const veloxManifest = JSON.parse(await readFile(join(root, "apps", "velox", "velox.json"), "utf8")) as unknown;
assertExactKeys(veloxManifest, ["$schema", "schemaVersion", "app", "assets", "window", "security"], "Velox manifest");
assertExactKeys(veloxManifest.app, ["id", "name", "version"], "Velox manifest app");
assertExactKeys(veloxManifest.assets, ["root", "entry"], "Velox manifest assets");
assertExactKeys(veloxManifest.window, ["width", "height"], "Velox manifest window");
assertExactKeys(veloxManifest.security, ["permissions"], "Velox manifest security");
if (
  veloxManifest.schemaVersion !== 1 ||
  veloxManifest.assets.root !== "web" ||
  veloxManifest.assets.entry !== "index.html" ||
  !Array.isArray(veloxManifest.security.permissions)
) {
  throw new Error("Velox adapter does not satisfy the pinned manifest v1 values");
}

const committedTauriIcon = await readFile(join(root, "apps", "tauri", "src-tauri", "icons", "icon.ico"));
if (!committedTauriIcon.equals(createTauriIcon())) {
  throw new Error("Tauri fixture icon differs from its deterministic source");
}

const adapters = [
  join(root, "apps", "velox", "web"),
  join(root, "apps", "wails", "frontend", "dist"),
  join(root, "apps", "neutralino", "resources"),
  join(root, "apps", "tauri", "frontend", "dist"),
];
const canonicalRoot = join(root, "fixtures", lock.fixture.name);
const digest = createHash("sha256");
for (const file of lock.fixture.files) {
  const canonical = await readFile(join(canonicalRoot, file));
  digest.update(file);
  digest.update(canonical);
  for (const adapter of adapters) {
    const candidate = await readFile(join(adapter, file));
    if (!canonical.equals(candidate)) {
      throw new Error(`${file} differs in ${adapter}`);
    }
  }
}

const workflow = await readFile(join(root, ".github", "workflows", "zero-cache.yml"), "utf8");
for (const [name, commit] of Object.entries(lock.actions)) {
  if (!workflow.includes(`@${commit}`)) {
    throw new Error(`zero-cache workflow does not use pinned actions.${name}`);
  }
}
if (/actions\/cache@/.test(workflow) || /^\s*cache:\s*true\s*$/m.test(workflow)) {
  throw new Error("zero-cache workflow enables a GitHub Actions cache");
}
const setupBunCount = [...workflow.matchAll(/^\s*uses:\s*oven-sh\/setup-bun@/gm)].length;
const disabledBunCacheCount = [...workflow.matchAll(/^\s*no-cache:\s*true\s*$/gm)].length;
if (setupBunCount === 0 || disabledBunCacheCount !== setupBunCount) {
  throw new Error("every setup-bun step must disable executable caching");
}
const setupNodeCount = [...workflow.matchAll(/^\s*uses:\s*actions\/setup-node@/gm)].length;
const disabledNodeCacheCount = [...workflow.matchAll(/^\s*package-manager-cache:\s*false\s*$/gm)].length;
if (disabledNodeCacheCount !== setupNodeCount) {
  throw new Error("every setup-node step must disable automatic package-manager caching");
}
for (const match of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) {
    throw new Error(`workflow action is not pinned to a commit: ${match[0].trim()}`);
  }
}
if (!workflow.includes("runs-on: windows-2025")) {
  throw new Error("zero-cache workflow does not use the pinned runner");
}
for (const marker of [
  "inputs.framework != 'all'",
  "inputs.framework == 'velox'",
  "format('[\"{0}\"]', inputs.framework)",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "inputs.framework == 'all'",
]) {
  if (!workflow.includes(marker)) throw new Error(`zero-cache diagnostic matrix is missing ${marker}`);
}

const startupWorkflow = await readFile(join(root, ".github", "workflows", "velox-startup.yml"), "utf8");
for (const action of ["checkout", "setupBun", "setupGo", "uploadArtifact", "downloadArtifact"] as const) {
  if (!startupWorkflow.includes(`@${lock.actions[action]}`)) {
    throw new Error(`startup workflow does not use pinned actions.${action}`);
  }
}
if (/actions\/cache@/.test(startupWorkflow) || /^\s*cache:\s*true\s*$/m.test(startupWorkflow)) {
  throw new Error("startup workflow enables a GitHub Actions cache");
}
for (const match of startupWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`startup workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "workflow_dispatch:",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "measure-velox-startup.ts",
  "summarize-startup.ts",
  "VELOX_STARTUP_EVIDENCE_LEVEL: hosted-pinned-source",
  "no-cache: true",
  "cache: false",
]) {
  if (!startupWorkflow.includes(marker)) throw new Error(`startup workflow is missing ${marker}`);
}
if (/^\s{2}(push|pull_request|schedule):/m.test(startupWorkflow)) {
  throw new Error("startup workflow must remain manual-only until its cost is measured");
}
for (const schema of ["startup-v1.schema.json", "startup-summary-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

console.log(JSON.stringify({ ok: true, fixtureSha256: digest.digest("hex"), adapters: adapters.length }));
