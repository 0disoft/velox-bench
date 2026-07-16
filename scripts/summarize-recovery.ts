import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRecoverySummary, type RecoveryResult } from "./recovery-contracts";

const [inputRoot, outputPath, expectedRaw] = process.argv.slice(2);
const expected = Number(expectedRaw) as 1 | 3 | 10;
if (!inputRoot || !outputPath || ![1, 3, 10].includes(expected)) throw new Error("usage: summarize-recovery <input-root> <output> <1|3|10>");

const files = (await readdir(inputRoot, { recursive: true })).filter((file) => file.endsWith(".json"));
const results: RecoveryResult[] = [];
for (const file of files) results.push(JSON.parse(await readFile(join(inputRoot, file), "utf8")) as RecoveryResult);
const summary = buildRecoverySummary(results, expected);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ outputPath, observed: summary.observed, publishable: summary.publishable, classification: summary.experimentClassification }));
