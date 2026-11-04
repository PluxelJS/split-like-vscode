/* oxlint-disable no-await-in-loop -- Native file validation/replacement and browser transitions must run serially. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function checkNativeDependencyBrowser(consumer) {
  const require = createRequire(join(consumer, "package.json"));
  const { chromium } = require("playwright");
  const { build, preview } = await import(pathToFileURL(require.resolve("vite")));
  await build({ root: consumer, logLevel: "warn" });
  const server = await preview({
    root: consumer,
    logLevel: "warn",
    preview: { host: "127.0.0.1", port: 0, open: false },
  });
  let browser;
  let page;
  const report = {
    status: "running",
    consumer,
    checks: [],
    pageErrors: [],
    limitations: [
      "Two real native Layouts; the integrated Worksplit and financial host browser acceptance is separate.",
    ],
  };
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Native preview did not listen");
    browser = await chromium.launch({ headless: true });
    report.chromiumVersion = browser.version();
    page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => report.pageErrors.push(String(error)));
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 900, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("http://127.0.0.1:" + address.port);
      await page.locator("#layout-0 input").waitFor();
      const source = await page.locator("#drag-0").boundingBox();
      const target = await page.locator("#layout-0").boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {
        steps: 3,
      });
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 10,
      });
      await page.mouse.move(target.x + target.width / 2 + 5, target.y + target.height / 2 + 5);
      await page.locator("#layout-0 .flexlayout__outline_rect").waitFor({ state: "attached" });
      await page.evaluate(() => window.nativeGate.refs[1].current.endDrag());
      assert.equal(
        await page.locator("#layout-0 .flexlayout__outline_rect").count(),
        1,
        "Another native Layout must not terminate the mouse drag",
      );
      await page.evaluate(() => {
        window.nativeGate.metrics.events.push("owner-endDrag");
        window.nativeGate.refs[0].current.endDrag();
      });
      assert.equal(
        await page.locator("#layout-0 .flexlayout__outline_rect").count(),
        0,
        "Owning Layout must remove the overlay synchronously",
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(
        await page.evaluate(
          () => window.nativeGate.models[0].getNodeById("dropped-0") !== undefined,
        ),
        false,
      );
      await page.locator("#cancel-0").focus();
      await page.keyboard.press("Enter");
      await page.locator("#layout-0 input").focus();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("Typing after native drag cancellation");
      assert.equal(
        await page.locator("#layout-0 input").inputValue(),
        "Typing after native drag cancellation",
      );
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {
        steps: 3,
      });
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 10,
      });
      await page.mouse.move(target.x + target.width / 2 + 5, target.y + target.height / 2 + 5);
      await page.locator("#layout-0 .flexlayout__outline_rect").waitFor({ state: "visible" });
      await page.mouse.up();
      await page.getByRole("textbox", { name: "Dropped 0", exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => window.nativeGate.models[0].getNodeById("dropped-0") !== undefined,
        ),
        true,
      );
      report.checks.push(
        `${viewport.width}×${viewport.height}: native mouse drag, cross-Layout isolation, cancellation, keyboard editing and subsequent drop`,
      );
    }
    assert.deepEqual(report.pageErrors, []);
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    if (page) {
      await page.screenshot({ path: join(consumer, "native-browser-failure.png") });
      report.layouts = await page.evaluate(() =>
        window.nativeGate?.models.map((model) => model.toJson()),
      );
      report.metrics = await page.evaluate(() => window.nativeGate?.metrics);
    }
    throw error;
  } finally {
    await browser?.close();
    await new Promise((done) => server.httpServer.close(done));
    await writeFile(
      join(consumer, "native-browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkNativeDependencyBrowser(resolve(process.argv[2]));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
