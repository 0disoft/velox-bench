import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type VeloxOutput = {
  portable: string;
  archive: string;
};

export async function resolveVeloxOutput(root: string): Promise<VeloxOutput> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const archives = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"));
  if (directories.length !== 1 || archives.length !== 1 || entries.length !== 2) {
    throw new Error("Velox output must contain exactly one portable directory and one ZIP archive");
  }
  return {
    portable: join(root, directories[0].name),
    archive: join(root, archives[0].name),
  };
}
