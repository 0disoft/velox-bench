import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameworks } from "./contracts";
import { frameworkAssetRoot, materializeAssetPackIntoProject } from "./fixture-materialization";

test("materializes generated assets into every framework web root", async () => {
  const root = await mkdtemp(join(tmpdir(), "velox-fixture-materialization-"));
  const generated = join(root, "generated");
  await Bun.write(join(generated, "assets", "sample.bin"), "fixture");

  for (const framework of frameworks) {
    const project = join(root, framework);
    await materializeAssetPackIntoProject(project, framework, generated);
    expect(await readFile(join(frameworkAssetRoot(project, framework), "assets", "sample.bin"), "utf8")).toBe("fixture");
  }
});
