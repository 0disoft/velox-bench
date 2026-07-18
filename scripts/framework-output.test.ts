import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveActutumOutput } from "./framework-output";

test("selects the complete Actutum directory and ZIP output without repackaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "actutum-framework-output-"));
  await mkdir(join(root, "dev.actutum.hello"));
  await Bun.write(join(root, "dev.actutum.hello.zip"), "zip");
  const output = await resolveActutumOutput(root);
  expect(output.portable).toBe(join(root, "dev.actutum.hello"));
  expect(output.archive).toBe(join(root, "dev.actutum.hello.zip"));
});

test("rejects undeclared files beside the Actutum outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "actutum-framework-output-extra-"));
  await mkdir(join(root, "dev.actutum.hello"));
  await Bun.write(join(root, "dev.actutum.hello.zip"), "zip");
  await Bun.write(join(root, "leftover.tmp"), "leftover");
  await expect(resolveActutumOutput(root)).rejects.toThrow("exactly one portable directory and one ZIP archive");
});
