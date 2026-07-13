import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Lock = {
  schemaVersion: string;
  runner: string;
  fixture: { name: string; files: string[] };
  frameworks: Record<string, Record<string, string>>;
};

const root = join(import.meta.dir, "..");
const lock = JSON.parse(await readFile(join(root, "bench.lock.json"), "utf8")) as Lock;

if (lock.schemaVersion !== "velox-bench-lock/v1" || lock.runner !== "windows-2025") {
  throw new Error("unsupported benchmark lock contract");
}
if (JSON.stringify(Object.keys(lock.frameworks).sort()) !== JSON.stringify(["neutralino", "velox", "wails"])) {
  throw new Error("framework lock must contain exactly neutralino, velox, and wails");
}

const commitPattern = /^[0-9a-f]{40}$/;
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

console.log(JSON.stringify({ ok: true, fixtureSha256: digest.digest("hex"), adapters: adapters.length }));
