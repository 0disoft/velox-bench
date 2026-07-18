import { cp } from "node:fs/promises";
import { join } from "node:path";
import type { Framework } from "./contracts";

const frameworkAssetRoots: Record<Framework, string> = {
  actutum: "web",
  wails: join("frontend", "dist"),
  neutralino: "resources",
  tauri: join("frontend", "dist"),
};

export function frameworkAssetRoot(project: string, framework: Framework): string {
  return join(project, frameworkAssetRoots[framework]);
}

export async function materializeAssetPackIntoProject(
  project: string,
  framework: Framework,
  generatedRoot: string,
): Promise<void> {
  await cp(join(generatedRoot, "assets"), join(frameworkAssetRoot(project, framework), "assets"), { recursive: true });
}
