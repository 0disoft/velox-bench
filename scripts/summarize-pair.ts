import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { validateResult, type Result } from "./contracts";
import { buildPairSummary } from "./pair-summary";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const expectedPerFramework = Number(process.argv[4]);
if (!input || !output || ![1, 3, 10].includes(expectedPerFramework)) {
  throw new Error("usage: summarize-pair.ts <raw-directory> <output> <expected-per-framework>");
}

const results: Result[] = [];
async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const result: unknown = JSON.parse(await readFile(path, "utf8"));
      validateResult(result);
      results.push(result);
    }
  }
}
await collect(input);

const summary = buildPairSummary(results, expectedPerFramework);
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output, scope: summary.scope, publishable: summary.publishable, results: results.length }));
