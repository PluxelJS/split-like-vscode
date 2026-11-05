import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createNativeDependencyArtifact,
  supportedNativeDependencies,
} from "./native-dependency-artifact.mjs";

test("cached artifacts stop applying removed patches", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "worksplit-artifact-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // The task dependency prepares the real deliverable; never mutate its copy.
  await cp(new URL("../packages/react/native-dependencies", import.meta.url), directory, {
    recursive: true,
  });
  const manifestPath = join(directory, "manifest.json");
  const original = JSON.parse(await readFile(manifestPath, "utf8"));
  const before = await stat(manifestPath);
  assert.ok(original.dependencies.every((dependency) => dependency.patch));
  const reused = await createNativeDependencyArtifact(directory);
  assert.deepEqual(reused.dependencies, original.dependencies);
  assert.equal((await stat(manifestPath)).mtimeMs, before.mtimeMs);

  const unpatched = supportedNativeDependencies.map(({ name, version }) => ({ name, version }));
  const regenerated = await createNativeDependencyArtifact(directory, unpatched);
  assert.deepEqual(regenerated.dependencies, unpatched);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")).dependencies, unpatched);
});
