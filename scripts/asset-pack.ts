import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const assetPackSchemaVersion = "actutum.asset-pack-fixture/v2" as const;

export type AssetPackManifest = {
  schemaVersion: typeof assetPackSchemaVersion;
  algorithm: "xorshift32-v1";
  seed: number;
  layout: {
    root: "assets";
    directories: number;
    fileCount: number;
    totalBytes: number;
    extension: ".bin";
  };
};

export type AssetPackDescription = {
  files: number;
  bytes: number;
  treeSha256: string;
};

export type AssetPackEntry = {
  index: number;
  path: string;
  bytes: Uint8Array;
};

export async function loadAssetPackManifest(path: string): Promise<AssetPackManifest> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as unknown;
  validateAssetPackManifest(manifest);
  return manifest;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} keys are invalid`);
  }
}

export function validateAssetPackManifest(value: unknown): asserts value is AssetPackManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("asset-pack manifest must be an object");
  const manifest = value as Partial<AssetPackManifest>;
  exactKeys(manifest as Record<string, unknown>, ["schemaVersion", "algorithm", "seed", "layout"], "asset-pack manifest");
  if (manifest.schemaVersion !== assetPackSchemaVersion || manifest.algorithm !== "xorshift32-v1") {
    throw new Error("unsupported asset-pack manifest contract");
  }
  if (!Number.isSafeInteger(manifest.seed) || manifest.seed! < 1 || manifest.seed! > 0xffff_ffff) {
    throw new Error("asset-pack seed must be a non-zero uint32");
  }
  if (!manifest.layout || typeof manifest.layout !== "object" || Array.isArray(manifest.layout)) {
    throw new Error("asset-pack layout is missing");
  }
  exactKeys(manifest.layout as unknown as Record<string, unknown>, ["root", "directories", "fileCount", "totalBytes", "extension"], "asset-pack layout");
  const { root, directories, fileCount, totalBytes, extension } = manifest.layout;
  if (root !== "assets" || extension !== ".bin") throw new Error("asset-pack path contract is invalid");
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > 100_000) throw new Error("asset-pack file count is invalid");
  if (!Number.isSafeInteger(directories) || directories < 1 || directories > fileCount || directories > 1_000) {
    throw new Error("asset-pack directory count is invalid");
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < fileCount || totalBytes > 1024 ** 3) {
    throw new Error("asset-pack byte budget is invalid");
  }
}

function fileSize(index: number, manifest: AssetPackManifest): number {
  const base = Math.floor(manifest.layout.totalBytes / manifest.layout.fileCount);
  const remainder = manifest.layout.totalBytes % manifest.layout.fileCount;
  return base + (index < remainder ? 1 : 0);
}

function filePath(index: number, manifest: AssetPackManifest): string {
  const perDirectory = Math.ceil(manifest.layout.fileCount / manifest.layout.directories);
  const directory = Math.floor(index / perDirectory);
  return `${manifest.layout.root}/${directory.toString().padStart(3, "0")}/${index.toString().padStart(6, "0")}${manifest.layout.extension}`;
}

function initialState(seed: number, index: number): number {
  let state = (seed ^ Math.imul(index + 1, 0x9e37_79b9)) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x85eb_ca6b) >>> 0;
  state ^= state >>> 13;
  state = Math.imul(state, 0xc2b2_ae35) >>> 0;
  state ^= state >>> 16;
  return state === 0 ? 0x6d2b_79f5 : state >>> 0;
}

function createAssetPackEntryUnchecked(index: number, manifest: AssetPackManifest): AssetPackEntry {
  if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.layout.fileCount) {
    throw new Error("asset-pack entry index is out of range");
  }
  const bytes = new Uint8Array(fileSize(index, manifest));
  let state = initialState(manifest.seed, index);
  for (let offset = 0; offset < bytes.length; offset += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    bytes[offset] = state & 0xff;
  }
  return { index, path: filePath(index, manifest), bytes };
}

export function createAssetPackEntry(index: number, manifest: AssetPackManifest): AssetPackEntry {
  validateAssetPackManifest(manifest);
  return createAssetPackEntryUnchecked(index, manifest);
}

function updateTreeDigest(hash: ReturnType<typeof createHash>, entry: AssetPackEntry): void {
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(entry.bytes.length));
  hash.update(entry.path, "utf8");
  hash.update(new Uint8Array([0]));
  hash.update(size);
  hash.update(entry.bytes);
}

export function describeAssetPack(manifest: AssetPackManifest): AssetPackDescription {
  validateAssetPackManifest(manifest);
  const hash = createHash("sha256");
  let bytes = 0;
  for (let index = 0; index < manifest.layout.fileCount; index += 1) {
    const entry = createAssetPackEntryUnchecked(index, manifest);
    bytes += entry.bytes.length;
    updateTreeDigest(hash, entry);
  }
  if (bytes !== manifest.layout.totalBytes) throw new Error("asset-pack generator violated its byte budget");
  return { files: manifest.layout.fileCount, bytes, treeSha256: hash.digest("hex") };
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`asset-pack output contains a symbolic link: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
      else throw new Error(`asset-pack output contains an unsupported entry: ${path}`);
    }
  }
  await walk(root);
  return files.sort();
}

export async function inspectAssetPack(root: string, manifest: AssetPackManifest): Promise<AssetPackDescription> {
  validateAssetPackManifest(manifest);
  const expectedPaths = Array.from({ length: manifest.layout.fileCount }, (_, index) => filePath(index, manifest)).sort();
  const actualPaths = await listFiles(resolve(root));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("asset-pack output paths differ from the manifest");
  const hash = createHash("sha256");
  let bytes = 0;
  for (let index = 0; index < manifest.layout.fileCount; index += 1) {
    const expected = createAssetPackEntryUnchecked(index, manifest);
    const actual = new Uint8Array(await readFile(join(root, ...expected.path.split("/"))));
    if (actual.length !== expected.bytes.length || !Buffer.from(actual).equals(Buffer.from(expected.bytes))) {
      throw new Error(`asset-pack output differs at ${expected.path}`);
    }
    bytes += actual.length;
    updateTreeDigest(hash, { ...expected, bytes: actual });
  }
  return { files: actualPaths.length, bytes, treeSha256: hash.digest("hex") };
}

export async function materializeAssetPack(target: string, manifest: AssetPackManifest): Promise<AssetPackDescription> {
  validateAssetPackManifest(manifest);
  const output = resolve(target);
  try {
    await stat(output);
    throw new Error(`asset-pack output already exists: ${output}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(output);
  const staging = join(parent, `.${basename(output)}.tmp-${process.pid}-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  try {
    for (let directory = 0; directory < manifest.layout.directories; directory += 1) {
      await mkdir(join(staging, manifest.layout.root, directory.toString().padStart(3, "0")), { recursive: true });
    }
    const batchSize = 32;
    for (let start = 0; start < manifest.layout.fileCount; start += batchSize) {
      const writes: Array<Promise<void>> = [];
      for (let index = start; index < Math.min(start + batchSize, manifest.layout.fileCount); index += 1) {
        const entry = createAssetPackEntryUnchecked(index, manifest);
        writes.push(writeFile(join(staging, ...entry.path.split("/")), entry.bytes));
      }
      await Promise.all(writes);
    }
    const description = await inspectAssetPack(staging, manifest);
    await rename(staging, output);
    return description;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
