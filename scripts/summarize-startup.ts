import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildStartupSummary, type StartupResult } from "./startup-contracts";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const expected = Number(process.argv[4]);
if (!input || !output || ![1, 3, 10].includes(expected)) {
  throw new Error("usage: summarize-startup.ts <raw-directory> <output> <expected-samples>");
}

const files = (await readdir(input, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
const results: StartupResult[] = [];
for (const file of files) results.push(JSON.parse(await readFile(file, "utf8")) as StartupResult);
const summary = buildStartupSummary(results, expected);
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output, observed: summary.observed, publishable: summary.publishable }));
if (summary.missing > 0 || summary.failed > 0 || summary.timedOut > 0) process.exit(1);
