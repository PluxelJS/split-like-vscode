import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createNativeDependencyArtifact,
  run,
  supportedNativeDependencies,
} from "./native-dependency-artifact.mjs";
import { packageDirectory } from "./native-dependency-install.mjs";

const repository = resolve(import.meta.dirname, "..");
const consumerArg = process.argv.indexOf("--consumer");
const consumer =
  consumerArg === -1
    ? await mkdtemp(join(tmpdir(), "worksplit-native-consumer-"))
    : resolve(process.argv[consumerArg + 1]);
const freshInstall = consumerArg === -1 || process.argv.includes("--install");
await mkdir(consumer, { recursive: true });
process.stdout.write("Independent native dependency evidence: " + consumer + "\n");
const report = {
  consumer,
  status: "running",
  checks: [],
  limitations: [
    "This gate proves native dependency capability and delivery; public Worksplit API, production browser and financial host acceptance remain separate.",
  ],
};
try {
  await cp(join(repository, "scripts/fixtures/native-dependency"), consumer, { recursive: true });
  if (freshInstall) {
    const installed = async (name) =>
      (await packageDirectory(name, join(repository, "packages/react"))).manifest.version;
    const versions = Object.fromEntries(
      await Promise.all(
        ["react", "react-dom", "typescript", "@types/react", "@types/react-dom", "jsdom"].map(
          async (name) => [name, await installed(name)],
        ),
      ),
    );
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "worksplit-native-dependency-consumer",
          private: true,
          type: "module",
          dependencies: {
            ...versions,
            ...Object.fromEntries(
              supportedNativeDependencies.map(({ name, version }) => [name, version]),
            ),
          },
          devDependencies: { vite: "8.3.3", playwright: "1.64.1" },
          overrides: { "@tanstack/router-core": "1.171.39", "@tanstack/history": "1.162.5" },
        },
        null,
        2,
      ) + "\n",
    );
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
    report.checks.push(
      "Independent registry install, without workspace symlinks or patchedDependencies",
    );
  }
  if (process.argv.includes("--prepare-only")) {
    report.status = "prepared";
  } else {
    if (freshInstall) await run(process.execPath, ["globals.mjs", "--baseline"], consumer);
    const baseline = JSON.parse(
      await run(process.execPath, ["singleton.mjs", "--probe"], consumer, true),
    );
    report.unpatchedSingletonRetained = baseline.retained;
    if (freshInstall) {
      assert.equal(
        baseline.retained,
        false,
        "The exact unpatched native release must reproduce the reported singleton defect",
      );
    }
    await cp(
      join(repository, "scripts/navigation-gate-regression.mjs"),
      join(consumer, "navigation-gate-regression.mjs"),
    );
    await cp(
      join(repository, "scripts/check-navigation-patch-runtime.mjs"),
      join(consumer, "check-navigation-patch-runtime.mjs"),
    );
    if (freshInstall) {
      await run(
        process.execPath,
        ["--conditions=browser", "navigation-gate-regression.mjs", consumer, "--baseline"],
        consumer,
      );
      report.checks.push(
        "Exact unpatched releases reproduce singleton removal and the documented Router/history defects",
      );
    }
    const artifact = await mkdtemp(join(tmpdir(), "worksplit-native-delivery-"));
    // A cold build must not depend on host npm/tar executables or their PATH shims.
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = "";
      await createNativeDependencyArtifact(artifact);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    report.checks.push("Cold artifact generation with no external commands on PATH");
    const archive = join(consumer, "native-dependencies.tgz");
    await run("tar", ["-czf", archive, "-C", artifact, "."], consumer);
    await mkdir(join(consumer, "native-dependencies"), { recursive: true });
    await run("tar", ["-xzf", archive, "-C", join(consumer, "native-dependencies")], consumer);
    report.artifact = archive;
    if (freshInstall) await run(process.execPath, ["installer-proof.mjs"], consumer);
    await run(process.execPath, ["native-dependencies/install.mjs"], consumer);
    if (freshInstall) await run(process.execPath, ["installer-proof.mjs", "--after"], consumer);
    const repeated = JSON.parse(
      await run(process.execPath, ["native-dependencies/install.mjs"], consumer, true),
    );
    assert.equal(repeated.changed, 0, "Repeated installation must be idempotent");
    report.checks.push(
      "Delivered archive installs with Node only; read-only checks reject missing or tampered files without writes; repeated installation is idempotent",
    );
    await run(process.execPath, ["singleton.mjs"], consumer);
    await run(process.execPath, ["globals.mjs"], consumer);
    await run(process.execPath, ["--conditions=browser", "runtime.mjs"], consumer);
    await run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);
    await run(join(consumer, "node_modules/.bin/tsc"), ["-p", "tsconfig.commonjs.json"], consumer);
    await run(process.execPath, ["check-navigation-patch-runtime.mjs", consumer], consumer);
    report.checks.push(
      "Native singleton identity; real Layout endDrag ownership; independent JS, types and CSS; 14 source/runtime parity checks",
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
    report.checks.push(
      "Same ESM and CJS Router/history regression on independently installed and corrected dependencies",
    );
    report.versions = repeated.versions;
    report.manifest = JSON.parse(
      await readFile(join(consumer, "native-dependencies/manifest.json"), "utf8"),
    );
    if (process.argv.includes("--browser")) {
      const { checkNativeDependencyBrowser } = await import("./native-dependency-browser.mjs");
      report.browser = await checkNativeDependencyBrowser(consumer);
      report.checks.push(
        "Production Chromium native drag ownership, cancellation, keyboard focus and subsequent drop",
      );
    }
    report.status = "passed";
  }
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(consumer, "native-dependency-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
