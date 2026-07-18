import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type ActutumOutput = {
  portable: string;
  archive: string;
};

export async function resolveActutumOutput(root: string): Promise<ActutumOutput> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const archives = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
  if (directories.length !== 1 || archives.length !== 1 || entries.length !== 2) {
    throw new Error("Actutum output must contain exactly one portable directory and one ZIP archive");
  }
  return {
    portable: join(root, directories[0].name),
    archive: join(root, archives[0].name),
  };
}
