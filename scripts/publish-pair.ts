import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildPairPublication, renderPairPublication, updateReadmePublication } from "./publication";

type PublicationLock = {
  publication?: {
    scope?: string;
    runId?: string;
    runAttempt?: number;
    benchmarkCommit?: string;
    directory?: string;
  };
};

const [sourceDirectory, metadataPath] = process.argv.slice(2);
if (!sourceDirectory || !metadataPath) {
  throw new Error("usage: bun scripts/publish-pair.ts <pair-summary-directory> <run-metadata.json>");
}
const root = process.cwd();
const lock = JSON.parse(await Bun.file(join(root, "bench.lock.json")).text()) as PublicationLock;
const config = lock.publication;
if (config?.scope !== "velox-wails" || !config.runId || !Number.isSafeInteger(config.runAttempt) ||
    !/^[0-9a-f]{40}$/.test(config.benchmarkCommit ?? "") || !config.directory?.startsWith("results/velox-wails/run-")) {
  throw new Error("bench.lock.json publication contract is invalid");
}
if (!config.directory.endsWith(config.runId)) throw new Error("publication directory does not match runId");

const summaryPath = resolve(sourceDirectory, "velox-wails.json");
const decisionPath = resolve(sourceDirectory, "velox-wails-decision.json");
const resolvedMetadataPath = resolve(metadataPath);
const summaryBytes = new Uint8Array(await Bun.file(summaryPath).arrayBuffer());
const decisionBytes = new Uint8Array(await Bun.file(decisionPath).arrayBuffer());
const metadataBytes = new Uint8Array(await Bun.file(resolvedMetadataPath).arrayBuffer());
const summary = JSON.parse(new TextDecoder().decode(summaryBytes));
const decision = JSON.parse(new TextDecoder().decode(decisionBytes));
const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
const publication = buildPairPublication(summary, decision, metadata, { summary: summaryBytes, decision: decisionBytes, metadata: metadataBytes }, {
  runId: config.runId,
  runAttempt: config.runAttempt!,
  benchmarkCommit: config.benchmarkCommit!,
});

const output = resolve(root, config.directory);
await mkdir(output, { recursive: true });
await Promise.all([
  Bun.write(join(output, "pair-summary.json"), summaryBytes),
  Bun.write(join(output, "pair-decision.json"), decisionBytes),
  Bun.write(join(output, "run-metadata.json"), metadataBytes),
  Bun.write(join(output, "publication.json"), `${JSON.stringify(publication, null, 2)}\n`),
]);
const readmePath = join(root, "README.md");
const readme = await Bun.file(readmePath).text();
await Bun.write(readmePath, updateReadmePublication(readme, renderPairPublication(publication)));
console.log(JSON.stringify({ ok: true, runId: publication.source.runId, output, readme: readmePath }));
