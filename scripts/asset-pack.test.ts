import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssetPackEntry, describeAssetPack, inspectAssetPack, materializeAssetPack, validateAssetPackManifest, type AssetPackManifest } from "./asset-pack";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function smallManifest(): AssetPackManifest {
  return {
    schemaVersion: "velox.asset-pack-fixture/v1",
    algorithm: "xorshift32-v1",
    seed: 123456789,
    layout: { root: "assets", directories: 3, fileCount: 10, totalBytes: 1031, extension: ".bin" },
  };
}

test("distributes the exact byte budget over stable paths", () => {
  const manifest = smallManifest();
  const entries = Array.from({ length: manifest.layout.fileCount }, (_, index) => createAssetPackEntry(index, manifest));
  expect(entries.map((entry) => entry.path)).toEqual([
    "assets/000/000000.bin", "assets/000/000001.bin", "assets/000/000002.bin", "assets/000/000003.bin",
    "assets/001/000004.bin", "assets/001/000005.bin", "assets/001/000006.bin", "assets/001/000007.bin",
    "assets/002/000008.bin", "assets/002/000009.bin",
  ]);
  expect(entries.reduce((total, entry) => total + entry.bytes.length, 0)).toBe(1031);
  expect(describeAssetPack(manifest)).toEqual(describeAssetPack(structuredClone(manifest)));
});

test("materializes byte-identical trees and refuses an existing destination", async () => {
  const parent = await mkdtemp(join(tmpdir(), "velox-asset-pack-"));
  roots.push(parent);
  const first = join(parent, "first");
  const second = join(parent, "second");
  const manifest = smallManifest();
  const firstDescription = await materializeAssetPack(first, manifest);
  const secondDescription = await materializeAssetPack(second, manifest);
  expect(firstDescription).toEqual(secondDescription);
  expect(await readFile(join(first, "assets", "000", "000000.bin"))).toEqual(await readFile(join(second, "assets", "000", "000000.bin")));
  await expect(materializeAssetPack(first, manifest)).rejects.toThrow("already exists");
});

test("inspection rejects unexpected output files", async () => {
  const parent = await mkdtemp(join(tmpdir(), "velox-asset-pack-extra-"));
  roots.push(parent);
  const output = join(parent, "output");
  const manifest = smallManifest();
  await materializeAssetPack(output, manifest);
  await writeFile(join(output, "unexpected.bin"), "unexpected");
  await expect(inspectAssetPack(output, manifest)).rejects.toThrow("paths differ");
});

test("rejects invalid layout budgets and indexes", () => {
  const manifest = smallManifest();
  expect(() => validateAssetPackManifest({ ...manifest, layout: { ...manifest.layout, totalBytes: 9 } })).toThrow("byte budget");
  expect(() => createAssetPackEntry(10, manifest)).toThrow("out of range");
});
