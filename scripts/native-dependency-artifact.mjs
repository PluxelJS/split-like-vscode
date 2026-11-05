/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyFilePatch, parsePatch, sha256 } from "./native-dependency-install.mjs";

const root = resolve(import.meta.dirname, "..");
// Resolve the build dependency from its owning package, including in a host workspace.
const { extract } = createRequire(new URL("../packages/react/package.json", import.meta.url))(
  "pacote",
);
export const supportedNativeDependencies = [
  { name: "flexlayout-react", version: "0.11.1", patch: "flexlayout-react@0.11.1.patch" },
  { name: "@tanstack/history", version: "1.162.5", patch: "@tanstack+history@1.162.5.patch" },
  {
    name: "@tanstack/router-core",
    version: "1.171.39",
    patch: "@tanstack+router-core@1.171.39.patch",
  },
  {
    name: "@tanstack/react-router",
    version: "1.170.46",
    patch: "@tanstack+react-router@1.170.46.patch",
  },
];

export function run(command, args, cwd, capture = false) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture)
      child.stdout.on("data", (data) => {
        output += data;
      });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun(output);
      else rejectRun(new Error(command + " failed: " + (signal ?? code)));
    });
  });
}

export async function createNativeDependencyArtifact(
  output,
  specifications = supportedNativeDependencies,
) {
  // Reuse the verified build artifact when source patches and the installer are unchanged.
  // Consumer installation never contacts the registry; pack can reuse this output offline.
  try {
    const cached = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    const installer = await readFile(
      join(import.meta.dirname, "native-dependency-install.mjs"),
      "utf8",
    );
    let valid =
      cached.format === 1 &&
      cached.dependencies.length === specifications.length &&
      installer === (await readFile(join(output, "install.mjs"), "utf8"));
    for (const specification of specifications) {
      const entry = cached.dependencies.find((value) => value.name === specification.name);
      const patchName = specification.patch ? "patches/" + specification.patch : undefined;
      if (!entry || entry.version !== specification.version || entry.patch !== patchName) {
        valid = false;
        break;
      }
      if (specification.patch) {
        const patch = await readFile(join(root, "patches", specification.patch), "utf8");
        if (
          entry.sha256 !== sha256(patch) ||
          (await readFile(join(output, entry.patch), "utf8")) !== patch
        ) {
          valid = false;
          break;
        }
      }
    }
    if (valid) return { directory: output, dependencies: cached.dependencies };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(join(tmpdir(), "worksplit-native-upstream-"));
  try {
    await mkdir(join(output, "patches"), { recursive: true });
    const dependencies = [];
    for (const specification of specifications) {
      if (!specification.patch) {
        dependencies.push(specification);
        continue;
      }
      const directory = join(staging, specification.name.replaceAll("/", "+"));
      // Fetch and verify the registry tarball directly, independent of npm/tar PATH shims.
      const { integrity } = await extract(
        specification.name + "@" + specification.version,
        directory,
        { ignoreScripts: true },
      );
      const patch = await readFile(resolve(root, "patches", specification.patch), "utf8");
      const files = [];
      for (const file of parsePatch(patch)) {
        const source = await readFile(join(directory, file.path), "utf8");
        const result = applyFilePatch(source, file);
        files.push({ path: file.path, before: sha256(source), after: sha256(result) });
      }
      const patchName = "patches/" + specification.patch;
      await writeFile(join(output, patchName), patch);
      dependencies.push({
        ...specification,
        patch: patchName,
        sha256: sha256(patch),
        upstreamIntegrity: integrity,
        files,
      });
    }
    await copyFile(
      join(import.meta.dirname, "native-dependency-install.mjs"),
      join(output, "install.mjs"),
    );
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify({ format: 1, dependencies }, null, 2) + "\n",
    );
    return { directory: output, dependencies };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2]
    ? resolve(process.argv[2])
    : await mkdtemp(join(tmpdir(), "worksplit-native-artifact-"));
  const result = await createNativeDependencyArtifact(output);
  process.stdout.write(
    JSON.stringify(
      {
        directory: result.directory,
        dependencies: result.dependencies.map(({ name, version, sha256: patchHash }) => ({
          name,
          version,
          patchHash,
        })),
      },
      null,
      2,
    ) + "\n",
  );
}
