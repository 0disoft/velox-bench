import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildPairDecision } from "./pair-decision";
import { validatePairSummary } from "./pair-summary";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!input || !output) throw new Error("usage: decide-pair.ts <pair-summary-json> <pair-decision-json>");
const summary: unknown = JSON.parse(await readFile(input, "utf8"));
validatePairSummary(summary);
const decision = buildPairDecision(summary);
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(decision, null, 2)}\n`);
console.log(JSON.stringify({ output, scope: decision.scope, status: decision.status, questionsRequired: decision.questionsRequired }));
