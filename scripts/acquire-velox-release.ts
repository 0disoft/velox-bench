import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Lock } from "./contracts";

const archiveLimitBytes = 64 * 1024 * 1024;

export type VeloxReleasePin = {
  repository: string;
  releaseTag: string;
  releaseAsset: string;
  releaseSha256: string;
  commit: string;
};

type AcquireOptions = {
  root: string;
  destination: string;
  fetchImpl?: typeof fetch;
  extract?: (archive: string, destination: string) => Promise<void>;
};

export function pinnedVeloxRelease(lock: Lock): VeloxReleasePin {
  const pin = lock.frameworks.velox;
  if (pin.repository !== "0disoft/velox") throw new Error("Velox release repository must be 0disoft/velox");
  if (!/^v\d+\.\d+\.\d+-alpha\.[1-9]\d*$/.test(pin.releaseTag)) throw new Error("Velox release tag is invalid");
  if (pin.releaseAsset !== "velox-windows-x64.zip") throw new Error("Velox release asset is invalid");
  if (!/^[0-9a-f]{64}$/.test(pin.releaseSha256)) throw new Error("Velox release SHA-256 is invalid");
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) throw new Error("Velox release commit is invalid");
  return pin;
}

export function veloxReleaseUrl(pin: VeloxReleasePin): string {
  return `https://github.com/${pin.repository}/releases/download/${pin.releaseTag}/${pin.releaseAsset}`;
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("Velox release response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > archiveLimitBytes) {
        await reader.cancel();
        throw new Error("Velox release exceeds the download limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("Velox release size is invalid");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function extractWithPowerShell(archive: string, destination: string): Promise<void> {
  const child = Bun.spawn([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:VELOX_ARCHIVE -DestinationPath $env:VELOX_EXTRACT_ROOT",
  ], {
    env: { ...process.env, VELOX_ARCHIVE: archive, VELOX_EXTRACT_ROOT: destination },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Velox release extraction failed with exit code ${exitCode}`);
}

export async function acquireVeloxRelease(options: AcquireOptions): Promise<{ destination: string; sha256: string; url: string }> {
  const lock = JSON.parse(await readFile(join(options.root, "bench.lock.json"), "utf8")) as Lock;
  const pin = pinnedVeloxRelease(lock);
  const destination = resolve(options.destination);
  const parent = dirname(destination);
  const temporary = join(parent, `.velox-release-${process.pid}-${Date.now()}`);
  const archive = join(temporary, pin.releaseAsset);
  const extracted = join(temporary, "extracted");
  const url = veloxReleaseUrl(pin);

  try {
    try {
      await stat(destination);
      throw new Error(`Velox release destination already exists: ${destination}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(extracted, { recursive: true });
    const response = await (options.fetchImpl ?? fetch)(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`Velox release download failed with HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > archiveLimitBytes) throw new Error("Velox release exceeds the download limit");
    const bytes = await readBoundedResponse(response);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== pin.releaseSha256) throw new Error("Velox release SHA-256 does not match bench.lock.json");
    await writeFile(archive, bytes, { flag: "wx" });

    await (options.extract ?? extractWithPowerShell)(archive, extracted);
    const releaseRoot = join(extracted, "velox-windows-x64");
    for (const name of ["velox.exe", "velox-host.exe", "release-manifest.json"]) {
      const file = await stat(join(releaseRoot, name));
      if (!file.isFile()) throw new Error(`Velox release is missing ${name}`);
    }
    const manifest = JSON.parse(await readFile(join(releaseRoot, "release-manifest.json"), "utf8")) as {
      releaseVersion?: unknown;
      target?: unknown;
    };
    if (manifest.releaseVersion !== pin.releaseTag.slice(1) || manifest.target !== "windows-x64") {
      throw new Error("Velox release manifest does not match the pinned tag and target");
    }
    await mkdir(parent, { recursive: true });
    await rename(releaseRoot, destination);
    return { destination, sha256, url };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination) throw new Error("usage: acquire-velox-release.ts <destination>");
  const result = await acquireVeloxRelease({ root: resolve(import.meta.dir, ".."), destination });
  console.log(JSON.stringify({
    release: basename(result.destination),
    destination: result.destination,
    sha256: result.sha256,
    url: result.url,
  }));
}
