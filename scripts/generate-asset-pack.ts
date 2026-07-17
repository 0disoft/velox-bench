import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describeAssetPack, materializeAssetPack, validateAssetPackManifest, type AssetPackManifest } from "./asset-pack";

type Lock = {
  assetPack?: { manifest?: string; expectedTreeSha256?: string };
};

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const describeOnly = args.includes("--describe");
const json = args.includes("--json");
const positional = args.filter((argument) => !argument.startsWith("--"));
if ((!describeOnly && positional.length !== 1) || (describeOnly && positional.length !== 0)) {
  throw new Error("usage: bun scripts/generate-asset-pack.ts <output> [--json] | --describe [--json]");
}

const lock = JSON.parse(await readFile(join(root, "bench.lock.json"), "utf8")) as Lock;
const manifestPath = lock.assetPack?.manifest;
const expectedTreeSha256 = lock.assetPack?.expectedTreeSha256;
if (!manifestPath || !/^[0-9a-f]{64}$/.test(expectedTreeSha256 ?? "")) throw new Error("bench.lock.json asset-pack contract is invalid");
const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8")) as AssetPackManifest;
validateAssetPackManifest(manifest);
const expected = describeAssetPack(manifest);

if (describeOnly) {
  const result = { ...expected, expectedTreeSha256, matchesLock: expected.treeSha256 === expectedTreeSha256 };
  console.log(json ? JSON.stringify(result) : result);
} else {
  if (expected.treeSha256 !== expectedTreeSha256) throw new Error("asset-pack generator digest differs from bench.lock.json");
  const output = resolve(positional[0]);
  const actual = await materializeAssetPack(output, manifest);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("materialized asset-pack differs from its deterministic description");
  const result = { ok: true, output, ...actual };
  console.log(json ? JSON.stringify(result) : result);
}
