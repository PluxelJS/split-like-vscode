/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installerArg = process.argv.indexOf("--installer");
const installer = resolve(
  installerArg === -1 ? "native-dependencies/install.mjs" : process.argv[installerArg + 1],
);
const { installNativeDependencies, nativePackages, sha256 } = await import(
  pathToFileURL(installer).href
);
const artifact = dirname(installer);
const manifest = JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8"));
const packages = await nativePackages(process.cwd());
const targets = manifest.dependencies.flatMap((dependency) =>
  (dependency.files ?? []).map((file) =>
    Object.assign({}, file, {
      path: join(packages.get(dependency.name).directory, file.path),
    }),
  ),
);
const first = targets[0];
const last = targets.at(-1);
const witness = join(process.cwd(), "native-hardlink-before.js");
const hashes = () =>
  Promise.all(targets.map(async (target) => sha256(await readFile(target.path))));
async function check(expectedStatus, expectedError) {
  const before = await hashes();
  const result = spawnSync(process.execPath, [installer, "--check", process.cwd()], {
    encoding: "utf8",
  });
  assert.equal(result.status, expectedStatus, result.stderr);
  if (expectedError) assert.match(result.stderr, expectedError);
  else assert.equal(JSON.parse(result.stdout).changed, 0);
  assert.deepEqual(await hashes(), before, "Read-only native checks must never rewrite any target");
}
if (process.argv.includes("--after")) {
  assert.equal(
    sha256(await readFile(witness)),
    first.before,
    "Atomic replacement must preserve the hardlinked upstream file",
  );
  assert.equal(
    sha256(await readFile(first.path)),
    first.after,
    "The installed file must contain the exact correction",
  );
  await check(0);
  const original = await readFile(last.path, "utf8");
  await writeFile(last.path + ".unknown", original + "\n// Unknown consumer change\n");
  await rename(last.path + ".unknown", last.path);
  try {
    await check(1, /Unrecognized upstream file/);
  } finally {
    await writeFile(last.path + ".restored", original);
    await rename(last.path + ".restored", last.path);
  }
  process.stdout.write(
    "Native installation replaced the link; read-only checks accept corrected files and reject tampering without writes\n",
  );
} else {
  await check(1, /Required native corrections are missing/);
  await link(first.path, witness);
  const original = await readFile(last.path, "utf8");
  await writeFile(last.path + ".unknown", original + "\n// Unknown consumer change\n");
  await rename(last.path + ".unknown", last.path);
  try {
    await check(1, /Unrecognized upstream file/);
    await assert.rejects(
      installNativeDependencies(process.cwd(), artifact),
      /Unrecognized upstream file/,
    );
    for (const target of targets.slice(0, -1)) {
      assert.equal(
        sha256(await readFile(target.path)),
        target.before,
        "An invalid final target must prevent every earlier write",
      );
    }
  } finally {
    await writeFile(last.path + ".restored", original);
    await rename(last.path + ".restored", last.path);
  }
  process.stdout.write("Unknown native content is rejected before any valid file is changed\n");
}
