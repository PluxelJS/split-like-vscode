/* oxlint-disable no-await-in-loop -- Installation, native mutations and acceptance run serially. */
import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { run, supportedNativeDependencies } from "./native-dependency-artifact.mjs";
import { packageDirectory } from "./native-dependency-install.mjs";

const root = resolve(import.meta.dirname, "..");
const consumer = await mkdtemp(join(tmpdir(), "worksplit-packed-consumer-"));
process.stdout.write("Packed consumer evidence: " + consumer + "\n");
const report = {
  consumer,
  status: "running",
  checks: [],
  limitations: [
    "This isolated consumer proves the distributed packages. Financial and external host migrations require their own acceptance.",
  ],
};
try {
  for (const name of ["react", "split-view"]) {
    await access(join(root, "packages", name, "dist/index.js"));
    await run(
      "pnpm",
      ["pack", "--out", join(consumer, name + ".tgz"), "--json"],
      join(root, "packages", name),
    );
  }
  await cp(join(root, "scripts/fixtures/packed-consumer"), consumer, { recursive: true });
  await mkdir(join(consumer, "src"));
  // README, development demo and installed consumer execute these exact sources.
  for (const path of ["main.tsx", "public-api.css", "examples"])
    await cp(join(root, "packages/demo/src", path), join(consumer, "src", path), {
      recursive: true,
    });
  const installed = async (name) =>
    (await packageDirectory(name, join(root, "packages/react"))).manifest.version;
  const versions = Object.fromEntries(
    await Promise.all(
      [
        "react",
        "react-dom",
        "@tanstack/react-store",
        "typescript",
        "@types/react",
        "@types/react-dom",
        "jsdom",
      ].map(async (name) => [name, await installed(name)]),
    ),
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "worksplit-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@worksplit/react": "file:./react.tgz",
          "@worksplit/split-view": "file:./split-view.tgz",
          ...versions,
          ...Object.fromEntries(
            supportedNativeDependencies.map(({ name, version }) => [name, version]),
          ),
        },
        devDependencies: { vite: "8.3.3" },
        overrides: { "@tanstack/router-core": "1.171.39", "@tanstack/history": "1.162.5" },
      },
      null,
      2,
    ) + "\n",
  );
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
  for (const script of ["navigation-gate-regression.mjs", "check-navigation-patch-runtime.mjs"])
    await cp(join(root, "scripts", script), join(consumer, script));
  await cp(
    join(root, "scripts/fixtures/native-dependency/globals.mjs"),
    join(consumer, "globals.mjs"),
  );
  await run(process.execPath, ["globals.mjs", "--baseline"], consumer);
  await run(
    process.execPath,
    ["--conditions=browser", "navigation-gate-regression.mjs", consumer, "--baseline"],
    consumer,
  );
  const installer = join(consumer, "node_modules/@worksplit/react/native-dependencies/install.mjs");
  await cp(
    join(root, "scripts/fixtures/native-dependency/installer-proof.mjs"),
    join(consumer, "installer-proof.mjs"),
  );
  await run(process.execPath, ["installer-proof.mjs", "--installer", installer], consumer);
  const first = JSON.parse(await run(process.execPath, [installer, consumer], consumer, true));
  assert.ok(first.changed > 0, "Published package must carry the required correction");
  const repeat = JSON.parse(await run(process.execPath, [installer, consumer], consumer, true));
  assert.equal(repeat.changed, 0, "Installation must be idempotent");
  await run(
    process.execPath,
    ["installer-proof.mjs", "--installer", installer, "--after"],
    consumer,
  );
  await run(process.execPath, ["globals.mjs"], consumer);
  report.checks.push(
    "Raw exact releases reproduce four defects; shipped offline installer applies every correction once; read-only checks reject missing or tampered files without writes",
  );
  await run(
    process.execPath,
    ["--conditions=browser", "navigation-gate-regression.mjs", consumer],
    consumer,
  );
  await run(
    process.execPath,
    ["--conditions=browser", "navigation-gate-regression.mjs", consumer, "--cjs"],
    consumer,
  );
  await run(process.execPath, ["check-navigation-patch-runtime.mjs", consumer], consumer);
  report.checks.push(
    "Same real Router regressions in ESM and CJS plus source/runtime parity assertions",
  );
  await run(process.execPath, ["--conditions=browser", "runtime.mjs"], consumer);
  await run(
    process.execPath,
    ["--conditions=browser", "--conditions=development", "runtime.mjs"],
    consumer,
  );
  const nativeTypes = join(consumer, "native-types");
  await mkdir(nativeTypes);
  for (const file of ["types.ts", "types-commonjs.cts", "tsconfig.json", "tsconfig.commonjs.json"])
    await cp(join(root, "scripts/fixtures/native-dependency", file), join(nativeTypes, file));
  await run(
    join(consumer, "node_modules/.bin/tsc"),
    ["-p", "native-types/tsconfig.json"],
    consumer,
  );
  await run(
    join(consumer, "node_modules/.bin/tsc"),
    ["-p", "native-types/tsconfig.commonjs.json"],
    consumer,
  );
  await run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);
  await run(
    join(consumer, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.json", "--customConditions", "development"],
    consumer,
  );
  report.checks.push(
    "Published JS, exact native identity, strict route/controller/examples types, CSS boundaries and version 2 restore",
  );
  // Keep the same heterogeneous Register proof isolated from the multi-router demo.
  await cp(
    join(root, "packages/react/consumers/registered-router.ts"),
    join(consumer, "registered-router.ts"),
  );
  await writeFile(
    join(consumer, "tsconfig.registered.json"),
    JSON.stringify({ extends: "./tsconfig.json", include: ["registered-router.ts"] }, null, 2) +
      "\n",
  );
  await run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.registered.json"], consumer);
  await run(
    join(consumer, "node_modules/.bin/tsc"),
    ["-p", "tsconfig.registered.json", "--customConditions", "development"],
    consumer,
  );
  report.checks.push(
    "The same closed heterogeneous Register consumer compiles against published declarations in both resolution conditions",
  );
  await run(join(consumer, "node_modules/.bin/vite"), ["build"], consumer);
  if (!process.argv.includes("--no-browser")) {
    const { checkPackageBrowser } = await import("./check-package-browser.mjs");
    const browser = await checkPackageBrowser(consumer);
    report.checks.push(...browser.checks);
  }
  const splitOnly = await mkdtemp(join(tmpdir(), "worksplit-split-only-"));
  await cp(join(consumer, "split-view.tgz"), join(splitOnly, "split-view.tgz"));
  await writeFile(
    join(splitOnly, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@worksplit/split-view": "file:./split-view.tgz",
          react: versions.react,
          "react-dom": versions["react-dom"],
        },
      },
      null,
      2,
    ) + "\n",
  );
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], splitOnly);
  await writeFile(
    join(splitOnly, "check.mjs"),
    'import assert from "node:assert/strict";\nimport {Pane,SplitView} from "@worksplit/split-view";\nimport {createElement} from "react";\nimport {renderToString} from "react-dom/server";\nassert.ok(renderToString(createElement(SplitView,null,createElement(Pane,{id:"one"},"One"))).includes("worksplit"));\nfor(const name of ["flexlayout-react","@tanstack/react-router","@tanstack/react-hotkeys","@worksplit/core"]) assert.throws(()=>import.meta.resolve(name));\n',
  );
  await run(process.execPath, ["check.mjs"], splitOnly);
  report.checks.push(
    "Independent SplitView-only install renders without Router, FlexLayout, Hotkeys or core",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await mkdir(join(root, "test-results/packed-consumer"), { recursive: true });
  await writeFile(
    join(root, "test-results/packed-consumer/results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
