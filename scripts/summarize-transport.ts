import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildTransportSummary, validateTransportResult, type TransportResult } from "./transport-contracts";

const input = process.argv[2];
const output = process.argv[3];
const expected = Number(process.argv[4]);
if (!input || !output || ![1, 3, 10].includes(expected)) throw new Error("usage: summarize-transport.ts <raw-directory> <output> <1|3|10>");

const results: TransportResult[] = [];
for (const name of (await readdir(resolve(input))).sort()) {
  if (!name.endsWith(".json")) continue;
  const value: unknown = JSON.parse(await readFile(resolve(input, name), "utf8"));
  validateTransportResult(value);
  results.push(value);
}
const summary = buildTransportSummary(results, expected as 1 | 3 | 10);
const outputPath = resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, classification: summary.transportClassification }));
