import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describeAssetPack, validateAssetPackManifest, type AssetPackManifest } from "./asset-pack";
import { buildPairPublication, renderPairPublication, serializeCanonicalJson, updateReadmePublication } from "./publication";
import { createTauriIcon } from "./tauri-icon";

type Lock = {
  schemaVersion: string;
  runner: string;
  toolchains: Record<string, string>;
  actions: Record<string, string>;
  fixture: { name: string; files: string[] };
  assetPack: { manifest: string; expectedTreeSha256: string };
  publication: { scope: string; runId: string; runAttempt: number; benchmarkCommit: string; directory: string };
  controls: Record<string, Record<string, string>>;
  frameworks: Record<string, Record<string, string>>;
};

const root = join(import.meta.dir, "..");
const lock = JSON.parse(await readFile(join(root, "bench.lock.json"), "utf8")) as Lock;
const commitPattern = /^[0-9a-f]{40}$/;
const exactVersionPattern = /^\d+\.\d+\.\d+$/;

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

if (lock.schemaVersion !== "velox-bench-lock/v3" || lock.runner !== "windows-2025") {
  throw new Error("unsupported benchmark lock contract");
}
if (lock.assetPack.manifest !== "fixtures/asset-pack/fixture.json" || !/^[0-9a-f]{64}$/.test(lock.assetPack.expectedTreeSha256)) {
  throw new Error("asset-pack lock must pin its manifest and deterministic tree digest");
}
const assetPackManifest = JSON.parse(await readFile(join(root, lock.assetPack.manifest), "utf8")) as AssetPackManifest;
validateAssetPackManifest(assetPackManifest);
if (assetPackManifest.layout.fileCount !== 1000 || assetPackManifest.layout.totalBytes !== 10 * 1024 * 1024) {
  throw new Error("asset-pack fixture must contain 1,000 generated files totaling exactly 10 MiB");
}
const assetPackDescription = describeAssetPack(assetPackManifest);
if (assetPackDescription.treeSha256 !== lock.assetPack.expectedTreeSha256) {
  throw new Error("asset-pack generator digest differs from bench.lock.json");
}
if (JSON.stringify(Object.keys(lock.frameworks).sort()) !== JSON.stringify(["neutralino", "tauri", "velox", "wails"])) {
  throw new Error("framework lock must contain exactly neutralino, tauri, velox, and wails");
}
if (JSON.stringify(Object.keys(lock.frameworks.velox).sort()) !== JSON.stringify(["commit", "releaseAsset", "releaseSha256", "releaseTag", "repository"]) ||
    lock.frameworks.velox.repository !== "0disoft/velox" ||
    !/^v\d+\.\d+\.\d+-alpha\.[1-9]\d*$/.test(lock.frameworks.velox.releaseTag) ||
    lock.frameworks.velox.releaseAsset !== "velox-windows-x64.zip" ||
    !/^[0-9a-f]{64}$/.test(lock.frameworks.velox.releaseSha256) ||
    !commitPattern.test(lock.frameworks.velox.commit)) {
  throw new Error("Velox framework input must pin one immutable public alpha asset, digest, and source commit");
}
if (Object.keys(lock.controls).length !== 2 || !lock.controls.webview2Binding || !commitPattern.test(lock.controls.webview2Binding.commit) ||
    !lock.controls.xsys || !/^v\d+\.\d+\.\d+$/.test(lock.controls.xsys.version)) {
  throw new Error("WebView2 binding and x/sys control dependencies must be pinned");
}
if (lock.publication.scope !== "velox-wails" || !/^\d+$/.test(lock.publication.runId) ||
    !Number.isSafeInteger(lock.publication.runAttempt) || lock.publication.runAttempt < 1 ||
    !commitPattern.test(lock.publication.benchmarkCommit) ||
    lock.publication.directory !== `results/velox-wails/run-${lock.publication.runId}`) {
  throw new Error("publication lock must pin one Velox-Wails run and benchmark revision");
}

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

const neutralinoConfig = JSON.parse(await readFile(join(root, "apps", "neutralino", "neutralino.config.json"), "utf8")) as {
  cli?: { binaryVersion?: string; clientVersion?: string; clientLibrary?: string };
  enableNativeAPI?: boolean;
  nativeAllowList?: string[];
};
if (neutralinoConfig.cli?.binaryVersion !== lock.frameworks.neutralino.version.replace(/^v/, "") ||
    neutralinoConfig.cli?.clientVersion !== lock.frameworks.neutralino.clientVersion.replace(/^v/, "") ||
    neutralinoConfig.cli?.clientLibrary !== "/resources/neutralino.js" || neutralinoConfig.enableNativeAPI !== true ||
    JSON.stringify(neutralinoConfig.nativeAllowList) !== JSON.stringify(["window.setTitle"])) {
  throw new Error("Neutralinojs relaunch bridge does not match pinned core and client contracts");
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
const zeroCacheMeasurement = await readFile(join(root, "scripts", "measure-zero-cache.ts"), "utf8");
if (!zeroCacheMeasurement.includes('throw new Error("VELOX_RELEASE_ROOT is required for Velox")')) {
  throw new Error("zero-cache Velox measurement does not fail closed without an explicit release root");
}
for (const name of ["checkout", "setupBun", "setupGo", "setupNode", "uploadArtifact", "downloadArtifact"] as const) {
  const commit = lock.actions[name];
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
  "environment-baseline:",
  "bun scripts/environment-gate.ts capture",
  "bun scripts/environment-gate.ts verify",
  "Validate environment baseline schema",
  "needs: [contracts, environment-baseline]",
  "bun scripts/acquire-velox-release.ts .bench/acquired/velox",
  "VELOX_RELEASE_ROOT:",
  "bun scripts/decide.ts",
  "bun scripts/summarize-pair.ts",
  "bun scripts/decide-pair.ts",
  "Validate summary and decision schemas",
  "schema/summary-v3.schema.json",
  "schema/decision-v1.schema.json",
  "schema/pair-summary-v1.schema.json",
  "schema/pair-decision-v1.schema.json",
  ".bench/summary/go-or-kill.json",
  "inputs.framework != 'all'",
  "inputs.framework == 'velox-wails'",
  "'[\"velox\",\"wails\"]'",
  "pair-measure:",
  "verify-pair",
  "first: velox",
  "first: wails",
  "raw-pair-${{ matrix.sample }}-${{ github.run_attempt }}",
  "needs: [environment-baseline, measure, pair-measure]",
  "format('[\"{0}\"]', inputs.framework)",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "inputs.framework == 'all'",
  "raw-${{ github.event_name == 'workflow_dispatch' && inputs.fixture || 'hello' }}-${{ matrix.framework }}-${{ matrix.sample }}-${{ github.run_attempt }}",
  "pattern: raw-*-${{ github.run_attempt }}",
  "Validate public result schemas",
  "schema/github-run-metadata-v1.schema.json",
  "schema/publication-v1.schema.json",
  "$lock.publication.directory",
  "Validate asset-pack manifest schema",
  "schema/asset-pack-v1.schema.json",
  "fixtures/asset-pack/fixture.json",
  "fixture:",
  "- asset-pack",
  "Validate dispatch scope and fixture",
  "Materialize selected asset-pack fixture",
  "bun scripts/generate-asset-pack.ts .bench/generated-fixture --json",
  "VELOX_BENCH_FIXTURE:",
  "VELOX_BENCH_ASSET_PACK_ROOT:",
]) {
  if (!workflow.includes(marker)) throw new Error(`zero-cache diagnostic matrix is missing ${marker}`);
}
for (const stale of ["Build pinned Velox producer artifact", "go run ./cmd/velox-release", "needs.velox-release.result"]) {
  if (workflow.includes(stale)) throw new Error(`zero-cache workflow retains source-built Velox acquisition: ${stale}`);
}
for (const schema of ["asset-pack-v1.schema.json", "result-v1.schema.json", "result-v2.schema.json", "summary-v1.schema.json", "summary-v2.schema.json", "summary-v3.schema.json", "environment-v1.schema.json", "decision-v1.schema.json", "pair-summary-v1.schema.json", "pair-decision-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const recommendedCacheWorkflow = await readFile(join(root, ".github", "workflows", "recommended-cache.yml"), "utf8");
const recommendedCacheMeasurement = await readFile(join(root, "scripts", "measure-recommended-cache.ts"), "utf8");
if (!recommendedCacheMeasurement.includes('throw new Error("VELOX_RELEASE_ROOT is required for Velox")')) {
  throw new Error("recommended-cache Velox measurement does not fail closed without an explicit release root");
}
for (const action of ["cache", "checkout", "setupBun", "setupGo", "setupNode", "uploadArtifact", "downloadArtifact"] as const) {
  if (!recommendedCacheWorkflow.includes(`@${lock.actions[action]}`)) {
    throw new Error(`recommended-cache workflow does not use pinned actions.${action}`);
  }
}
for (const match of recommendedCacheWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`recommended-cache workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "workflow_dispatch:",
  "prime:",
  "warm:",
  "cleanup:",
  "actions/cache/restore@",
  "actions/cache/save@",
  "fail-on-cache-miss: true",
  "bun scripts/cache-api.ts inspect",
  "bun scripts/cache-api.ts delete-scope",
  "bun scripts/finalize-recommended-cache.ts",
  "bun scripts/summarize-recommended-cache.ts",
  "schema/recommended-cache-result-v1.schema.json",
  "schema/recommended-cache-summary-v1.schema.json",
  "permissions:",
  "actions: write",
  "bun scripts/acquire-velox-release.ts .bench/recommended-cache/acquired/velox",
]) {
  if (!recommendedCacheWorkflow.includes(marker)) throw new Error(`recommended-cache workflow is missing ${marker}`);
}
for (const stale of ["Build pinned Velox producer artifact", "go run ./cmd/velox-release", "needs.velox-release.result"]) {
  if (recommendedCacheWorkflow.includes(stale)) throw new Error(`recommended-cache workflow retains source-built Velox acquisition: ${stale}`);
}
if (/^\s{2}(pull_request|schedule):/m.test(recommendedCacheWorkflow)) {
  throw new Error("recommended-cache workflow must not consume cache quota on pull requests or a schedule");
}
for (const schema of ["recommended-cache-result-v1.schema.json", "recommended-cache-summary-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const startupWorkflow = await readFile(join(root, ".github", "workflows", "velox-startup.yml"), "utf8");
for (const action of ["checkout", "setupBun", "uploadArtifact", "downloadArtifact"] as const) {
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
  "collect-startup-history.ts",
  "startup-history-",
  "VELOX_STARTUP_EVIDENCE_LEVEL: hosted-pinned-release",
  "bun scripts/acquire-velox-release.ts .bench/acquired/velox",
  "no-cache: true",
  "startup-raw-${{ matrix.sample }}-${{ github.run_attempt }}",
  "pattern: startup-raw-*-${{ github.run_attempt }}",
]) {
  if (!startupWorkflow.includes(marker)) throw new Error(`startup workflow is missing ${marker}`);
}
for (const stale of ["Build pinned Velox producer artifact", "go run ./cmd/velox-release", "VELOX_STARTUP_EVIDENCE_LEVEL: hosted-pinned-source"]) {
  if (startupWorkflow.includes(stale)) throw new Error(`startup workflow retains source-built Velox acquisition: ${stale}`);
}
if (/^\s{2}(push|pull_request|schedule):/m.test(startupWorkflow)) {
  throw new Error("startup workflow must remain manual-only until its cost is measured");
}
for (const schema of ["startup-v1.schema.json", "startup-v2.schema.json", "startup-summary-v1.schema.json", "startup-history-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const controlVersion = lock.controls.webview2Binding.version.replace(/^v/, "");
for (const moduleFile of [join(root, "apps", "webview2-control", "go.mod"), join(root, "harness", "relaunch", "go.mod")]) {
  const module = await readFile(moduleFile, "utf8");
  if (!module.includes(`github.com/jchv/go-webview2 v${controlVersion}`)) throw new Error(`${moduleFile} does not use the pinned WebView2 control binding`);
}
for (const moduleFile of [
  join(root, "apps", "webview2-control", "go.mod"),
  join(root, "apps", "webview2-transport-control", "go.mod"),
  join(root, "harness", "relaunch", "go.mod"),
]) {
  const module = await readFile(moduleFile, "utf8");
  if (!module.includes(`golang.org/x/sys ${lock.controls.xsys.version}`)) {
    throw new Error(`${moduleFile} does not use pinned controls.xsys.version`);
  }
}
const relaunchWorkflow = await readFile(join(root, ".github", "workflows", "relaunch-controls.yml"), "utf8");
for (const action of ["checkout", "setupBun", "setupGo", "setupNode", "uploadArtifact", "downloadArtifact"] as const) {
  if (!relaunchWorkflow.includes(`@${lock.actions[action]}`)) throw new Error(`relaunch workflow does not use pinned actions.${action}`);
}
for (const revision of [lock.frameworks.velox.commit, lock.controls.webview2Binding.commit, lock.frameworks.wails.commit, lock.frameworks.neutralino.commit]) {
  if (!relaunchWorkflow.includes(revision)) throw new Error(`relaunch workflow does not pin revision ${revision}`);
}
if (/actions\/cache@/.test(relaunchWorkflow) || /^\s*cache:\s*true\s*$/m.test(relaunchWorkflow)) throw new Error("relaunch workflow enables a GitHub Actions cache");
for (const match of relaunchWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`relaunch workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "velox", "webview2-control", "framework-managed-app-directory", "summarize-relaunch.ts",
  "relaunch-control-v1.schema.json", "relaunch-control-summary-v2.schema.json",
  "relaunch-raw-${{ matrix.framework }}-${{ matrix.sample }}-${{ github.run_attempt }}",
  "pattern: relaunch-raw-*-${{ github.run_attempt }}",
]) {
  if (!relaunchWorkflow.includes(marker)) throw new Error(`relaunch workflow is missing ${marker}`);
}
for (const schema of ["relaunch-control-v1.schema.json", "relaunch-control-summary-v1.schema.json", "relaunch-control-summary-v2.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const transportModule = await readFile(join(root, "apps", "webview2-transport-control", "go.mod"), "utf8");
if (!transportModule.includes("replace github.com/jchv/go-webview2 => ../../.bench/velox-source/third_party/go-webview2")) {
  throw new Error("asset transport control must use the pinned Velox WebView2 fork checkout");
}
const transportSource = await readFile(join(root, "apps", "webview2-transport-control", "main.go"), "utf8");
for (const marker of ["file-url", "virtual-host", "web-resource", "SetVirtualHostNameToFolderMapping", "SetWebResourceRequestHandler"]) {
  if (!transportSource.includes(marker)) throw new Error(`asset transport control source is missing ${marker}`);
}
const transportWorkflow = await readFile(join(root, ".github", "workflows", "asset-transport-controls.yml"), "utf8");
for (const action of ["checkout", "setupBun", "setupGo", "uploadArtifact", "downloadArtifact"] as const) {
  if (!transportWorkflow.includes(`@${lock.actions[action]}`)) {
    throw new Error(`asset transport workflow does not use pinned actions.${action}`);
  }
}
if (!transportWorkflow.includes(`ref: ${lock.frameworks.velox.commit}`) ||
    !transportWorkflow.includes(`--revision ${lock.frameworks.velox.commit}`)) {
  throw new Error("asset transport workflow Velox revision differs from frameworks.velox.commit");
}
if (/actions\/cache@/.test(transportWorkflow) || /^\s*cache:\s*true\s*$/m.test(transportWorkflow)) {
  throw new Error("asset transport workflow enables a GitHub Actions cache");
}
for (const match of transportWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`asset transport workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "workflow_dispatch:",
  "fork-file-url",
  "fork-virtual-host",
  "fork-web-resource",
  "velox.asset-transport-relaunch/v1",
  "summarize-transport.ts",
  "asset-transport-relaunch-v1.schema.json",
  "asset-transport-relaunch-summary-v1.schema.json",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "'[0,1,2,3,4,5,6,7,8,9]'",
  "no-cache: true",
  "cache: false",
  "asset-transport-raw-${{ matrix.transport }}-${{ matrix.sample }}-${{ github.run_attempt }}",
  "pattern: asset-transport-raw-*-${{ github.run_attempt }}",
]) {
  if (!transportWorkflow.includes(marker)) throw new Error(`asset transport workflow is missing ${marker}`);
}
if (/^\s{2}(push|pull_request|schedule):/m.test(transportWorkflow)) {
  throw new Error("asset transport workflow must remain manual-only");
}
for (const schema of ["asset-transport-relaunch-v1.schema.json", "asset-transport-relaunch-summary-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const delayWorkflow = await readFile(join(root, ".github", "workflows", "asset-transport-delay-sweep.yml"), "utf8");
for (const action of ["checkout", "setupBun", "setupGo", "uploadArtifact", "downloadArtifact"] as const) {
  if (!delayWorkflow.includes(`@${lock.actions[action]}`)) {
    throw new Error(`asset transport delay workflow does not use pinned actions.${action}`);
  }
}
if (!delayWorkflow.includes(`ref: ${lock.frameworks.velox.commit}`) ||
    !delayWorkflow.includes(`--revision ${lock.frameworks.velox.commit}`)) {
  throw new Error("asset transport delay workflow Velox revision differs from frameworks.velox.commit");
}
if (/actions\/cache@/.test(delayWorkflow) || /^\s*cache:\s*true\s*$/m.test(delayWorkflow)) {
  throw new Error("asset transport delay workflow enables a GitHub Actions cache");
}
for (const match of delayWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`asset transport delay workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "workflow_dispatch:",
  "$delays = @(0, 100, 250, 500, 1000)",
  "$offset = ([int] $env:SAMPLE) % $delays.Count",
  ".bench/profiles-delay/$env:TRANSPORT-$env:SAMPLE-$delay",
  "velox.asset-transport-delay/v1",
  "asset-transport-relaunch-delay-sweep",
  "summarize-delay-sweep.ts",
  "asset-transport-delay-v1.schema.json",
  "asset-transport-delay-summary-v1.schema.json",
  "asset-delay-raw-${{ matrix.transport }}-${{ matrix.sample }}-${{ github.run_attempt }}",
  "asset-delay-raw-*-${{ github.run_attempt }}",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "'[0,1,2,3,4,5,6,7,8,9]'",
  "no-cache: true",
  "cache: false",
]) {
  if (!delayWorkflow.includes(marker)) throw new Error(`asset transport delay workflow is missing ${marker}`);
}
if (/^\s{2}(push|pull_request|schedule):/m.test(delayWorkflow)) {
  throw new Error("asset transport delay workflow must remain manual-only");
}
for (const schema of ["asset-transport-delay-v1.schema.json", "asset-transport-delay-summary-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const recoveryWorkflow = await readFile(join(root, ".github", "workflows", "asset-transport-recovery.yml"), "utf8");
for (const action of ["checkout", "setupBun", "setupGo", "uploadArtifact", "downloadArtifact"] as const) {
  if (!recoveryWorkflow.includes(`@${lock.actions[action]}`)) throw new Error(`asset recovery workflow does not use pinned actions.${action}`);
}
if (!recoveryWorkflow.includes(`ref: ${lock.frameworks.velox.commit}`) ||
    !recoveryWorkflow.includes(`--revision ${lock.frameworks.velox.commit}`)) {
  throw new Error("asset recovery workflow Velox revision differs from frameworks.velox.commit");
}
if (/actions\/cache@/.test(recoveryWorkflow) || /^\s*cache:\s*true\s*$/m.test(recoveryWorkflow)) {
  throw new Error("asset recovery workflow enables a GitHub Actions cache");
}
for (const match of recoveryWorkflow.matchAll(/^\s*uses:\s*[^@\s]+@([^\s#]+)/gm)) {
  if (!commitPattern.test(match[1])) throw new Error(`asset recovery workflow action is not pinned to a commit: ${match[0].trim()}`);
}
for (const marker of [
  "workflow_dispatch:",
  "$delays = @(0, 1000, 2000, 4000, 6000, 7000)",
  "velox-same-profile",
  "velox-fresh-profile",
  "file-url-same-profile",
  "file-url-fresh-profile",
  "virtual-host-same-profile",
  "virtual-host-fresh-profile",
  "virtual-host-fresh-origin",
  "velox.asset-transport-recovery/v1",
  "asset-transport-recovery-boundary",
  "summarize-recovery.ts",
  "asset-transport-recovery-v1.schema.json",
  "asset-transport-recovery-summary-v1.schema.json",
  "asset-recovery-raw-${{ matrix.scenario }}-${{ matrix.sample }}-${{ github.run_attempt }}",
  "pattern: asset-recovery-raw-*-${{ github.run_attempt }}",
  "inputs.sample_count == '3'",
  "'[0,1,2]'",
  "'[0,1,2,3,4,5,6,7,8,9]'",
  "no-cache: true",
  "cache: false",
]) {
  if (!recoveryWorkflow.includes(marker)) throw new Error(`asset recovery workflow is missing ${marker}`);
}
if (/^\s{2}(push|pull_request|schedule):/m.test(recoveryWorkflow)) throw new Error("asset recovery workflow must remain manual-only");
for (const schema of ["asset-transport-recovery-v1.schema.json", "asset-transport-recovery-summary-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

const relaunchHarness = await readFile(join(root, "harness", "relaunch", "main.go"), "utf8");
for (const [name, value] of [
  ["delaySchemaVersion", "velox.asset-transport-delay/v1"],
  ["recoverySchemaVersion", "velox.asset-transport-recovery/v1"],
]) {
  if (!new RegExp(`${name}\\s*=\\s*"${value}"`).test(relaunchHarness)) {
    throw new Error(`relaunch harness is missing schema constant ${name}`);
  }
}
for (const marker of [
  'json:"requestedDelayMs,omitempty"',
  'json:"scenario,omitempty"',
  'json:"browserProcessId"',
  'json:"startupTimeline"',
  'json:"shutdownTimeline"',
  'json:"actualProcessStartAfterFirstHostExitMs"',
  'json:"relaunched"',
  'flag.Int("relaunch-delay-ms", 0',
]) {
  if (!relaunchHarness.includes(marker)) throw new Error(`relaunch harness is missing delay contract marker ${marker}`);
}

const publicationRoot = join(root, lock.publication.directory);
const publicationSummaryText = await readFile(join(publicationRoot, "pair-summary.json"), "utf8");
const publicationDecisionText = await readFile(join(publicationRoot, "pair-decision.json"), "utf8");
const publicationMetadataText = await readFile(join(publicationRoot, "run-metadata.json"), "utf8");
const publication = buildPairPublication(
  JSON.parse(publicationSummaryText),
  JSON.parse(publicationDecisionText),
  JSON.parse(publicationMetadataText),
  { runId: lock.publication.runId, runAttempt: lock.publication.runAttempt, benchmarkCommit: lock.publication.benchmarkCommit },
);
const publicationText = await readFile(join(publicationRoot, "publication.json"), "utf8");
if (serializeCanonicalJson(JSON.parse(publicationText)) !== serializeCanonicalJson(publication)) {
  throw new Error("committed publication differs from its machine-generated source evidence");
}
const readme = await readFile(join(root, "README.md"), "utf8");
if (updateReadmePublication(readme, renderPairPublication(publication)) !== readme) {
  throw new Error("README publication block differs from publication.json");
}
for (const schema of ["github-run-metadata-v1.schema.json", "publication-v1.schema.json"]) {
  JSON.parse(await readFile(join(root, "schema", schema), "utf8"));
}

console.log(JSON.stringify({ ok: true, fixtureSha256: digest.digest("hex"), adapters: adapters.length }));
