/* oxlint-disable no-await-in-loop -- Native file validation/replacement and browser transitions must run serially. */
import { createHash } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Only the ordinary text-file unified diffs shipped in this artifact are accepted.
// Context and old/new hunk lengths are checked; there is no fuzzy application.
export function parsePatch(source) {
  const files = [];
  let file;
  let hunk;
  for (const line of source.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (!match || match[1] !== match[2] || match[1].split("/").includes("..")) {
        throw new Error("Unsupported patch file header: " + line);
      }
      file = { path: match[1], hunks: [] };
      files.push(file);
      hunk = undefined;
    } else if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!file || !match) throw new Error("Invalid patch hunk: " + line);
      hunk = {
        start: Number(match[1]),
        oldLength: Number(match[2] ?? 1),
        newLength: Number(match[4] ?? 1),
        lines: [],
      };
      file.hunks.push(hunk);
    } else if (hunk && /^[ +-]/.test(line)) {
      hunk.lines.push(line);
    } else if (hunk && line === "\\ No newline at end of file") {
      const previous = hunk.lines.at(-1)?.[0];
      if (!previous) throw new Error("Invalid patch newline marker");
      if (previous === "-") file.newline ??= true;
      else file.newline = false;
    }
  }
  if (!files.length || files.some((entry) => !entry.hunks.length)) throw new Error("Empty patch");
  return files;
}

export function applyFilePatch(source, file) {
  const original = source.split("\n");
  if (source.endsWith("\n")) original.pop();
  const result = [];
  let cursor = 0;
  for (const hunk of file.hunks) {
    const start = Math.max(0, hunk.start - 1);
    if (start < cursor) throw new Error("Overlapping patch hunks: " + file.path);
    result.push(...original.slice(cursor, start));
    cursor = start;
    let oldLength = 0;
    let newLength = 0;
    for (const line of hunk.lines) {
      const kind = line[0];
      const value = line.slice(1);
      if (kind !== "+") {
        if (original[cursor] !== value)
          throw new Error("Patch context mismatch: " + file.path + ":" + (cursor + 1));
        ++cursor;
        ++oldLength;
      }
      if (kind !== "-") {
        result.push(value);
        ++newLength;
      }
    }
    if (oldLength !== hunk.oldLength || newLength !== hunk.newLength)
      throw new Error("Patch hunk length mismatch: " + file.path);
  }
  result.push(...original.slice(cursor));
  return result.join("\n") + ((file.newline ?? source.endsWith("\n")) ? "\n" : "");
}

export async function packageDirectory(name, from) {
  const require = createRequire(join(from, "package.json"));
  let entry;
  try {
    entry = require.resolve(name + "/package.json");
  } catch {
    entry = require.resolve(name);
  }
  let directory = dirname(entry);
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) return { directory: await realpath(directory), manifest };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Cannot find package root: " + name);
    directory = parent;
  }
}

export async function nativePackages(consumer) {
  const packages = new Map();
  for (const name of ["react", "react-dom", "flexlayout-react", "@tanstack/react-router"]) {
    packages.set(name, await packageDirectory(name, consumer));
  }
  const router = packages.get("@tanstack/react-router");
  packages.set(
    "@tanstack/router-core",
    await packageDirectory("@tanstack/router-core", router.directory),
  );
  packages.set(
    "@tanstack/history",
    await packageDirectory("@tanstack/history", packages.get("@tanstack/router-core").directory),
  );
  const owners = new Map(packages);
  try {
    owners.set("@worksplit/react", await packageDirectory("@worksplit/react", consumer));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }
  for (const [ownerName, owner] of owners) {
    const dependencies = { ...owner.manifest.dependencies, ...owner.manifest.peerDependencies };
    for (const name of packages.keys()) {
      if (!dependencies[name]) continue;
      const dependency = await packageDirectory(name, owner.directory);
      if (dependency.directory !== packages.get(name).directory) {
        throw new Error("Duplicate native dependency: " + ownerName + " resolves another " + name);
      }
    }
  }
  return packages;
}

export async function installNativeDependencies(consumer, artifact, { checkOnly = false } = {}) {
  const manifest = JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8"));
  if (manifest.format !== 1) throw new Error("Unsupported native patch artifact format");
  const packages = await nativePackages(consumer);
  const changes = [];
  let alreadyApplied = 0;
  for (const dependency of manifest.dependencies) {
    const installed = packages.get(dependency.name);
    if (!installed || installed.manifest.version !== dependency.version) {
      throw new Error(
        "Expected " +
          dependency.name +
          "@" +
          dependency.version +
          "; installed " +
          installed?.manifest.version,
      );
    }
    if (!dependency.patch) continue;
    const patch = await readFile(join(artifact, dependency.patch), "utf8");
    if (sha256(patch) !== dependency.sha256)
      throw new Error("Patch artifact checksum mismatch: " + dependency.name);
    const patches = parsePatch(patch);
    if (patches.length !== dependency.files.length)
      throw new Error("Patch file inventory mismatch: " + dependency.name);
    for (const file of patches) {
      const expected = dependency.files.find((entry) => entry.path === file.path);
      if (!expected) throw new Error("Unlisted patch target: " + file.path);
      const path = join(installed.directory, file.path);
      const source = await readFile(path, "utf8");
      const hash = sha256(source);
      if (hash === expected.after) {
        ++alreadyApplied;
        continue;
      }
      if (hash !== expected.before)
        throw new Error("Unrecognized upstream file; refusing to modify " + path);
      const result = applyFilePatch(source, file);
      if (sha256(result) !== expected.after)
        throw new Error("Patched file checksum mismatch: " + path);
      changes.push({ path, result, mode: (await stat(path)).mode });
    }
  }
  if (checkOnly && changes.length) {
    throw new Error(
      "Required native corrections are missing from " +
        changes.length +
        " files; run the installer",
    );
  }
  // Validate the entire install before touching any file. Rename replaces pnpm's
  // hardlinks instead of changing the content-addressed store shared by other apps.
  for (const change of changes) {
    const temporary = change.path + ".worksplit-" + process.pid;
    await writeFile(temporary, change.result, { flag: "wx", mode: change.mode });
    await rename(temporary, change.path);
  }
  return {
    changed: changes.length,
    alreadyApplied,
    versions: Object.fromEntries(
      [...packages].map(([name, value]) => [name, value.manifest.version]),
    ),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const paths = args.filter((arg) => arg !== "--check");
  if (paths.length > 1 || paths.some((arg) => arg.startsWith("--")))
    throw new Error("Usage: node install.mjs [--check] [consumer-directory]");
  const result = await installNativeDependencies(
    resolve(paths[0] ?? process.cwd()),
    import.meta.dirname,
    { checkOnly: args.includes("--check") },
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
