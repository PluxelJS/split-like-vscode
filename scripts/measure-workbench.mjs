/* oxlint-disable unicorn/consistent-function-scoping -- Playwright serializes the callback and its browser-local helpers. */
/* oxlint-disable no-await-in-loop -- Workloads and browser contexts are deliberately serial. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkPublicApiBrowser, chromium } from "./check-public-api-browser.mjs";

export async function measureWorkbench({ native = false } = {}) {
  const root = resolve(import.meta.dirname, "..");
  const output = join(root, "test-results/measurements");
  await mkdir(output, { recursive: true });
  // A measurement is not allowed to stand in for behavior acceptance.
  await checkPublicApiBrowser({ reportFile: join(output, "behavior.json") });
  const require = createRequire(join(root, "packages/demo/package.json"));
  const { preview } = await import(pathToFileURL(require.resolve("vite")));
  const server = await preview({
    configFile: join(root, "packages/demo/vite.public-api.config.ts"),
    logLevel: "warn",
    preview: { host: "127.0.0.1", port: 0, open: false },
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  const report = {
    workload: native ? "worksplit-v2-native-groups-1" : "worksplit-v2-documents-1",
    status: "running",
    environment: {
      node: process.version,
      browser: browser.version(),
      platform: `${os.platform()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      viewport: { width: 1440, height: 900 },
      bundle: "Vite production; cold browser contexts and shared warm HTTP server",
      nativeDependencies: JSON.parse(
        await readFile(join(root, "packages/react/native-dependencies/manifest.json"), "utf8"),
      ).dependencies.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    },
    samplesPerSize: 1,
    results: [],
    limitations: [
      "Current workload timings are not a historical performance improvement claim. Compare only matching workload and behavior evidence.",
      "Routes are the same local read-only demo; there is no simulated network, accounting workload or heap-leak inference.",
      "Two animation frames are included after each visible open/activation. Native change events and explicit Model serialization calls measure work, not speculative React renders.",
    ],
  };
  try {
    for (const count of [2, 10, 50, 200]) {
      const context = await browser.newContext({ viewport: report.environment.viewport });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.getByRole("button", { name: "Open results", exact: true }).waitFor();
      const sample = await page.evaluate(
        async ({ count: documentCount, native: groupWorkload }) => {
          const {
            readOnly: instance,
            native: { Actions, DockLocation },
          } = window.worksplitPublic;
          const frames = () =>
            new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          const must = (result) => {
            if (result.status !== "applied") throw new Error(JSON.stringify(result));
            return result.value;
          };
          let changes = 0,
            serializations = 0,
            effectsStarted = 0,
            effectsReleased = 0;
          const listener = () => {
            ++changes;
          };
          instance.model.addChangeListener(listener);
          const serialize = instance.model.toJson;
          instance.model.toJson = function () {
            ++serializations;
            return serialize.call(this);
          };
          const ids = [];
          const seeds = [];
          const start = performance.now();
          for (let index = 0; index < documentCount; ++index) {
            const destination =
              index === 1
                ? { target: instance.getDocument(ids[0]).containerId, location: DockLocation.RIGHT }
                : index > 1
                  ? {
                      target: instance.getDocument(seeds[index % 2]).containerId,
                      location: DockLocation.CENTER,
                    }
                  : undefined;
            const opened = must(
              await instance.open(
                { to: "/read/$name", params: { name: `Bench ${index}` } },
                { reuse: "new", ...(destination ? { destination } : {}) },
              ),
            ).document;
            ids.push(opened.id);
            if (index < 2) seeds.push(opened.id);
            opened.handle.runEffect(({ defer }) => {
              ++effectsStarted;
              defer(() => {
                ++effectsReleased;
              });
            });
            await frames();
            const element = document.querySelector(`[data-worksplit-content="${opened.id}"]`);
            if (!element?.getClientRects().length)
              throw new Error("Opened content was not visibly committed");
          }
          const openMs = performance.now() - start;
          const afterOpenChanges = changes;
          const beforeRead = serializations;
          const readAt = performance.now();
          for (let index = 0; index < 1000; ++index) {
            instance.getDocuments();
            instance.getContainers();
            instance.getContext();
          }
          const readMs = performance.now() - readAt;
          if (serializations !== beforeRead)
            throw new Error("Ordinary queries serialized the Model");
          let groupMs = 0,
            groupActions = 0;
          if (groupWorkload) {
            const groups = [];
            const groupAt = performance.now();
            for (const [index, id] of seeds.entries()) {
              must(await instance.dispatch(Actions.addTabToNewGroup(id, `Group ${index}`)));
              ++groupActions;
              groups.push(instance.model.getNodeById(id).getParent());
            }
            for (const [index, id] of ids.slice(2).entries()) {
              must(
                await instance.dispatch(
                  Actions.moveNode(id, groups[index % 2].getId(), DockLocation.CENTER, -1),
                ),
              );
              ++groupActions;
            }
            for (const group of groups) {
              must(
                await instance.dispatch(
                  Actions.updateNodeAttributes(group.getId(), { opened: false }),
                ),
              );
              must(
                await instance.dispatch(
                  Actions.updateNodeAttributes(group.getId(), { opened: true }),
                ),
              );
              groupActions += 2;
            }
            await frames();
            groupMs = performance.now() - groupAt;
          }
          const switchAt = performance.now();
          for (let index = 0; index < 20; ++index) {
            must(await instance.activate(ids[index % ids.length]));
            await frames();
          }
          const switchMs = performance.now() - switchAt;
          if (
            instance.getDocuments().length !== documentCount ||
            effectsStarted !== documentCount ||
            effectsReleased !== 0
          )
            throw new Error("Layout operations changed content lifetime");
          const closeAt = performance.now();
          must(await instance.close(ids));
          const closeMs = performance.now() - closeAt;
          if (instance.getDocuments().length !== 0 || effectsReleased !== documentCount)
            throw new Error("Close did not settle every resource");
          const snapshot = instance.createSnapshot();
          if (snapshot.version !== 2) throw new Error("Snapshot schema changed");
          instance.model.toJson = serialize;
          instance.model.removeChangeListener(listener);
          await window.worksplitPublic.dispose();
          return {
            count: documentCount,
            openMs,
            readMs,
            readCount: 1000,
            switchMs,
            switchCount: 20,
            groupMs,
            groupActions,
            closeMs,
            afterOpenChanges,
            nativeChanges: changes,
            serializations,
            effectsStarted,
            effectsReleased,
          };
        },
        { count, native },
      );
      report.results.push(sample);
      await context.close();
    }
    const baselineArg = process.argv.indexOf("--baseline");
    if (baselineArg !== -1) {
      const baseline = JSON.parse(await readFile(resolve(process.argv[baselineArg + 1]), "utf8"));
      assert.equal(baseline.status, "passed");
      assert.equal(baseline.workload, report.workload);
      assert.deepEqual(
        baseline.environment,
        report.environment,
        "Timing comparison requires the same environment and native correction",
      );
      assert.deepEqual(
        baseline.results.map((value) => [
          value.count,
          value.readCount,
          value.switchCount,
          value.groupActions,
          value.effectsStarted,
          value.effectsReleased,
        ]),
        report.results.map((value) => [
          value.count,
          value.readCount,
          value.switchCount,
          value.groupActions,
          value.effectsStarted,
          value.effectsReleased,
        ]),
        "Baseline must perform identical accepted work and cleanup",
      );
      report.comparison = report.results.map((value, index) => ({
        count: value.count,
        openMs: value.openMs - baseline.results[index].openMs,
        switchMs: value.switchMs - baseline.results[index].switchMs,
        closeMs: value.closeMs - baseline.results[index].closeMs,
        nativeChanges: value.nativeChanges - baseline.results[index].nativeChanges,
        serializations: value.serializations - baseline.results[index].serializations,
      }));
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = String(error?.stack ?? error);
    throw error;
  } finally {
    await browser.close();
    await new Promise((done) => server.httpServer.close(done));
    await writeFile(
      join(output, native ? "native.json" : "workbench.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await measureWorkbench();
