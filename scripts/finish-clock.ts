import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("usage: finish-clock.ts <start-clock> <output>");
const startedAtMs = Number(await readFile(resolve(input), "utf8"));
if (!Number.isFinite(startedAtMs)) throw new Error("invalid start clock");
const result = { durationMs: Math.max(0, Date.now() - startedAtMs) };
await mkdir(dirname(resolve(output)), { recursive: true });
await Bun.write(resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
