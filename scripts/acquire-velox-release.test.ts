import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { acquireVeloxRelease, pinnedVeloxRelease, veloxReleaseUrl } from "./acquire-velox-release";
import type { Lock } from "./contracts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function lock(bytes: Uint8Array): Lock {
  return {
    schemaVersion: "velox-bench-lock/v3",
    runner: "windows-2025",
    toolchains: { bun: "1.3.14", go: "1.26.4", node: "24.18.0", rust: "1.96.1" },
    actions: {},
    fixture: { name: "hello", files: [] },
    assetPack: { manifest: "fixture.json", expectedTreeSha256: "0".repeat(64) },
    frameworks: {
      velox: {
        repository: "0disoft/velox",
        releaseTag: "v0.5.10-alpha.1",
        releaseAsset: "velox-windows-x64.zip",
        releaseSha256: createHash("sha256").update(bytes).digest("hex"),
        commit: "1".repeat(40),
      },
      wails: { repository: "wailsapp/wails", version: "v2.13.0", commit: "2".repeat(40) },
      neutralino: { repository: "neutralinojs/neutralinojs", version: "v6.8.0", commit: "3".repeat(40) },
      tauri: { repository: "tauri-apps/tauri", version: "v2.11.2", commit: "4".repeat(40) },
    },
  };
}

async function fixture(bytes: Uint8Array): Promise<{ root: string; destination: string }> {
  const root = await mkdtemp(join(tmpdir(), "velox-release-test-"));
  roots.push(root);
  await writeFile(join(root, "bench.lock.json"), `${JSON.stringify(lock(bytes))}\n`);
  return { root, destination: join(root, "acquired", "velox") };
}

describe("Velox release acquisition", () => {
  test("validates the immutable public release identity", () => {
    const pin = pinnedVeloxRelease(lock(new Uint8Array([1])));
    expect(veloxReleaseUrl(pin)).toBe("https://github.com/0disoft/velox/releases/download/v0.5.10-alpha.1/velox-windows-x64.zip");
  });

  test("rejects mutable or foreign release pins", () => {
    const value = lock(new Uint8Array([1]));
    value.frameworks.velox.releaseTag = "latest";
    expect(() => pinnedVeloxRelease(value)).toThrow("tag is invalid");
    value.frameworks.velox.releaseTag = "v0.5.10-alpha.1";
    value.frameworks.velox.repository = "example/velox";
    expect(() => pinnedVeloxRelease(value)).toThrow("must be 0disoft/velox");
  });

  test("promotes only a digest-matched release with required files", async () => {
    const bytes = new TextEncoder().encode("pinned archive");
    const { root, destination } = await fixture(bytes);
    const result = await acquireVeloxRelease({
      root,
      destination,
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      extract: async (_archive, extracted) => {
        const release = join(extracted, "velox-windows-x64");
        await mkdir(release, { recursive: true });
        await writeFile(join(release, "velox.exe"), "velox.exe");
        await writeFile(join(release, "velox-host.exe"), "velox-host.exe");
        await writeFile(join(release, "release-manifest.json"), JSON.stringify({ releaseVersion: "0.5.10-alpha.1", target: "windows-x64" }));
      },
    });
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(await readFile(join(destination, "velox.exe"), "utf8")).toBe("velox.exe");
  });

  test("removes partial state after a digest mismatch", async () => {
    const expected = new TextEncoder().encode("expected");
    const { root, destination } = await fixture(expected);
    await expect(acquireVeloxRelease({
      root,
      destination,
      fetchImpl: async () => new Response("different", { status: 200 }),
    })).rejects.toThrow("does not match");
    await expect(readFile(join(destination, "velox.exe"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects a declared archive larger than the bounded download", async () => {
    const bytes = new TextEncoder().encode("small body");
    const { root, destination } = await fixture(bytes);
    await expect(acquireVeloxRelease({
      root,
      destination,
      fetchImpl: async () => new Response(bytes, {
        status: 200,
        headers: { "content-length": String(64 * 1024 * 1024 + 1) },
      }),
    })).rejects.toThrow("download limit");
  });
});
