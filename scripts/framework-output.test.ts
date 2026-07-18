import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVeloxOutput } from "./framework-output";

test("selects the complete Velox directory and ZIP output without repackaging", async () => {
  const root = await mkdtemp(join(tmpdir(), "velox-framework-output-"));
  await mkdir(join(root, "dev.velox.hello"));
  await Bun.write(join(root, "dev.velox.hello.zip"), "zip");
  const output = await resolveVeloxOutput(root);
  expect(output.portable).toBe(join(root, "dev.velox.hello"));
  expect(output.archive).toBe(join(root, "dev.velox.hello.zip"));
});

test("rejects undeclared files beside the Velox outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "velox-framework-output-extra-"));
  await mkdir(join(root, "dev.velox.hello"));
  await Bun.write(join(root, "dev.velox.hello.zip"), "zip");
  await Bun.write(join(root, "leftover.tmp"), "leftover");
  await expect(resolveVeloxOutput(root)).rejects.toThrow("exactly one portable directory and one ZIP archive");
});
