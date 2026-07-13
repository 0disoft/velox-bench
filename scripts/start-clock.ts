import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const path = process.argv[2];
if (!path) throw new Error("clock output path is required");
await mkdir(dirname(path), { recursive: true });
await writeFile(path, String(Date.now()), "utf8");
