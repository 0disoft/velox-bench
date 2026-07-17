import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDecision } from "./decision";
import { validateSummary } from "./summary";

const input = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
if (!input || !output) throw new Error("usage: decide.ts <summary-json> <decision-json>");
const summary: unknown = JSON.parse(await readFile(input, "utf8"));
validateSummary(summary);
const decision = buildDecision(summary);
await mkdir(dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(decision, null, 2)}\n`);
console.log(JSON.stringify({ output, status: decision.status, questionsRequired: decision.questionsRequired }));
