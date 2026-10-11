import { spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const consumer = await mkdtemp(join(tmpdir(), "worksplit-packed-consumer-"));
process.stdout.write("Packed consumer evidence: " + consumer + "\n");

try {
  await Promise.all(
    [
      "packages/core/dist/index.js",
      "packages/react/dist/index.js",
      "packages/react/dist/style.css",
    ].map((file) => access(resolve(root, file))),
  );
  await run(
    "pnpm",
    ["--filter", "@worksplit/core", "pack", "--out", join(consumer, "core.tgz"), "--json"],
    root,
  );
  await run(
    "pnpm",
    ["--filter", "@worksplit/react", "pack", "--out", join(consumer, "react.tgz"), "--json"],
    root,
  );
  await cp(resolve(root, "scripts/fixtures/packed-consumer"), consumer, { recursive: true });
  const dependencies = Object.fromEntries(
    await Promise.all(
      [
        "react",
        "react-dom",
        "flexlayout-react",
        "@tanstack/react-router",
        "@tanstack/react-store",
        "@tanstack/react-hotkeys",
      ].map(async (name) => [name, await installedVersion(name)]),
    ),
  );
  const devDependencies = Object.fromEntries(
    await Promise.all(
      ["typescript", "vite", "@vitejs/plugin-react", "@types/react", "@types/react-dom"].map(
        async (name) => [name, await installedVersion(name)],
      ),
    ),
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "worksplit-packed-consumer",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { dev: "vite --host 127.0.0.1", preview: "vite preview --host 127.0.0.1" },
        dependencies: {
          "@worksplit/core": "file:./core.tgz",
          "@worksplit/react": "file:./react.tgz",
          ...dependencies,
        },
        devDependencies,
      },
      null,
      2,
    ) + "\n",
  );
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
  await run(process.execPath, ["runtime.mjs"], consumer);
  await run(process.execPath, ["--conditions=development", "runtime.mjs"], consumer);
  await run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);
  await run(
    join(consumer, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json", "--customConditions", "development"],
    consumer,
  );
  await run(join(consumer, "node_modules/.bin/vite"), ["build"], consumer);
  if (process.argv.includes("--browser")) {
    const { checkPackageBrowser } = await import("./check-package-browser.mjs");
    const report = await checkPackageBrowser(consumer);
    process.stdout.write(
      "Packed production browser acceptance passed: " + report.checks.length + " checks\n",
    );
  }
  process.stdout.write(
    "Packed public JS, types and CSS checks passed. Evidence and preview app: " + consumer + "\n",
  );
} catch (error) {
  process.stderr.write(
    String(error) +
      "\nPacked consumer check failed; temporary evidence remains at " +
      consumer +
      "\n",
  );
  process.exitCode = 1;
}

async function installedVersion(name) {
  const candidates = ["packages/demo", ".", "packages/react"].map((directory) =>
    readFile(resolve(root, directory, "node_modules", name, "package.json"), "utf8"),
  );
  const results = await Promise.allSettled(candidates);
  const found = results.find((result) => result.status === "fulfilled");
  if (!found) throw new Error("Install workspace dependencies before test:package: " + name);
  const manifest = JSON.parse(found.value);
  if (manifest.name !== name || typeof manifest.version !== "string")
    throw new Error("Invalid installed package: " + name);
  return manifest.version;
}

function run(command, args, cwd) {
  process.stdout.write("\n" + command + " " + args.join(" ") + "\n");
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(command + " failed: " + (signal ?? code)));
    });
  });
}
