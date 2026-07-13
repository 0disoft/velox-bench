import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
if (/actions\/cache@/.test(workflow) || /cache:\s*true/.test(workflow)) {
  throw new Error("zero-cache workflow enables a GitHub Actions cache");
}
for (const match of workflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) {
    throw new Error(`workflow action is not pinned to a commit: ${match[0].trim()}`);
  }
}
if (!workflow.includes("runs-on: windows-2025")) {
  throw new Error("zero-cache workflow does not use the pinned runner");
}

console.log(JSON.stringify({ ok: true, fixtureSha256: digest.digest("hex"), adapters: adapters.length }));
