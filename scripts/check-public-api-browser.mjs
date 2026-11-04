import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(repository, "package.json"));
const demoRequire = createRequire(join(repository, "packages/demo/package.json"));
// A standalone checkout declares @playwright/test. The parent workspace supplies
// the same official Playwright runtime through Vite+'s declared optional peer.
let browserTools;
try {
  browserTools = require("@playwright/test");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  browserTools = createRequire(require.resolve("vite-plus/package.json"))("playwright");
}
export const { chromium } = browserTools;
export async function checkPublicApiBrowser(options = {}) {
  const viteRequire = options.consumer
    ? createRequire(join(options.consumer, "package.json"))
    : demoRequire;
  const { build, preview } = await import(pathToFileURL(viteRequire.resolve("vite")));
  const configFile =
    options.configFile ?? join(repository, "packages/demo/vite.public-api.config.ts");
  const reportFile =
    options.reportFile ?? join(repository, "test-results/public-api/browser-results.json");
  const report = {
    status: "running",
    checks: [],
    pageErrors: [],
    limitations: [
      options.consumer
        ? "Installed public tarballs and their shipped native correction; financial host acceptance remains separate."
        : "Public source exports and production browser bundle; final package archive and financial host acceptance run separately.",
    ],
  };
  let browser;
  let server;
  let currentPage;
  await mkdir(dirname(reportFile), { recursive: true });
  try {
    if (options.build !== false) await build({ configFile, logLevel: "warn" });
    server = await preview({
      configFile,
      logLevel: "warn",
      preview: { host: "127.0.0.1", port: 0, open: false },
    });
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ headless: true });
    report.chromiumVersion = browser.version();
    async function checkViewport(viewport) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      currentPage = page;
      page.setDefaultTimeout(8000);
      page.on("pageerror", (error) => report.pageErrors.push(String(error)));
      await page.goto(`http://127.0.0.1:${address.port}${options.entry ?? "/"}`);
      await page.getByRole("button", { name: "Open results", exact: true }).click();
      await page.getByRole("tab", { name: "Report", exact: true }).waitFor();
      const handle = await page.getByRole("button", { name: "Drag Balance report" }).boundingBox();
      const tab = await page.getByRole("tab", { name: "Report", exact: true }).boundingBox();
      assert.ok(handle && tab);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 14, handle.y + handle.height / 2, {
        steps: 3,
      });
      await page.mouse.move(tab.x + 3, tab.y + tab.height / 2, { steps: 10 });
      await page.mouse.move(tab.x + 4, tab.y + tab.height / 2 + 1);
      await page.locator(".flexlayout__outline_rect").waitFor({ state: "visible" });
      await page.mouse.up();
      await page.waitForFunction(() => window.worksplitPublic.readOnly.getDocuments().length === 2);
      assert.equal(
        await page.evaluate(() => {
          const workbench = window.worksplitPublic.readOnly;
          return workbench.getDocument(workbench.getContainers()[0].tabIds[0])?.href;
        }),
        "/read/Balance",
      );
      const before = await page.evaluate(() =>
        window.worksplitPublic.readOnly.getDocuments().map((value) => value.id),
      );
      await page.getByRole("tab", { name: "Report", exact: true }).first().focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: "Split Right", exact: true }).click();
      await page.waitForFunction(
        () =>
          window.worksplitPublic.readOnly.getContainers().filter((value) => value.kind === "tabset")
            .length === 2,
      );
      assert.deepEqual(
        await page.evaluate(() =>
          window.worksplitPublic.readOnly.getDocuments().map((value) => value.id),
        ),
        before,
      );
      // Model commit precedes React presentation. Resolve the two actual native
      // tabsets before directing a key to chrome that the split may still replace.
      await page.waitForFunction(() => {
        const containers = window.worksplitPublic.readOnly
          .getContainers()
          .filter((value) => value.kind === "tabset");
        if (document.querySelectorAll(".flexlayout__tabset").length !== containers.length)
          return false;
        const rendered = containers.map((container) => {
          const parents = new Set(
            container.tabIds.map((id) =>
              document.getElementById(`flexlayout-tabbutton-${id}`)?.closest(".flexlayout__tabset"),
            ),
          );
          return parents.size === 1 ? [...parents][0] : undefined;
        });
        return rendered.every(Boolean) && new Set(rendered).size === 2;
      });
      const content = page.locator("[data-worksplit-content]:visible").first();
      const focusTarget = await content.evaluate((element) => {
        const panel = element.closest('[role="tabpanel"]');
        const tabId = panel?.getAttribute("aria-labelledby");
        const button = tabId ? document.getElementById(tabId) : null;
        return {
          key: panel?.getAttribute("aria-keyshortcuts"),
          tabId,
          accepted:
            panel?.id === button?.getAttribute("aria-controls") &&
            tabId === `flexlayout-tabbutton-${element.getAttribute("data-worksplit-content")}`,
        };
      });
      assert.ok(focusTarget.accepted, "Native panel and tab refer to the accepted content");
      assert.ok(focusTarget.key, "Native tab panel advertises its focus toggle");
      await content.focus();
      await page.keyboard.press(focusTarget.key);
      await page.waitForFunction((id) => document.activeElement?.id === id, focusTarget.tabId);
      assert.equal(await page.evaluate(() => document.activeElement?.id), focusTarget.tabId);
      report.checks.push(
        `${viewport.width}×${viewport.height}: read-only open, real drag/index, split preserves content, native keyboard focus`,
      );

      await page.getByRole("button", { name: "Editor", exact: true }).click();
      const input = page.getByRole("textbox", { name: "Text", exact: true });
      await input.fill("Submitted draft");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await input.fill("Newer draft");
      await page.waitForFunction(
        () => localStorage.getItem("worksplit-example:editor:Draft") === "Submitted draft",
      );
      assert.equal(await input.inputValue(), "Newer draft");
      assert.match(await page.getByRole("status").innerText(), /Unsaved changes/);
      await page.getByRole("button", { name: "Fail the next save", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "demonstration save failed" }).waitFor();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("worksplit-example:editor:Draft")),
        "Submitted draft",
      );
      await page.getByRole("tab", { name: "Draft", exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Close", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      assert.equal(await page.getByRole("menu").count(), 0);
      await page.getByRole("button", { name: "Keep editing", exact: true }).click();
      assert.equal(await input.isEnabled(), true);
      await page.evaluate(() => {
        const workspace = window.worksplitPublic;
        const router = workspace.editorRouters.get(workspace.editor.getActiveDocument().id);
        const gate = { settled: false, release: undefined, unblock: undefined };
        gate.unblock = router.history.block({
          blockerFn: () =>
            new Promise((settleBlocker) => {
              gate.release = () => settleBlocker(true);
            }),
        });
        window.publicPause = gate;
        void router.navigate({ to: "/edit/$name", params: { name: "Other" } }).then(() => {
          gate.settled = true;
          return undefined;
        });
      });
      await page.getByRole("button", { name: "Save and leave", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("textarea")?.disabled === true);
      assert.equal(await input.isDisabled(), true);
      await page.evaluate(() => {
        window.publicPause.release();
        window.publicPause.unblock();
      });
      await page.waitForFunction(
        () => window.publicPause.settled && document.querySelector("textarea")?.disabled === false,
      );
      await page.getByRole("button", { name: "Close active", exact: true }).click();
      await page.waitForFunction(() => window.worksplitPublic.editor.getDocuments().length === 0);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("worksplit-example:editor:Draft")),
        "Newer draft",
      );
      report.checks.push(
        `${viewport.width}×${viewport.height}: actual saved basis, newer edits stay dirty, failed save preserves copy, menu closes before cancelable leave dialog, approved editor pauses until native refusal settles`,
      );

      await page.getByRole("button", { name: "Tools", exact: true }).click();
      const filter = page.getByRole("textbox", { name: "Filter", exact: true });
      await filter.fill("Tool local state");
      await page.getByRole("button", { name: "Open report", exact: true }).click();
      await page.getByRole("tab", { name: "Report", exact: true }).click({ button: "right" });
      const inspect = page.getByRole("menuitem", { name: "Inspect content", exact: true });
      assert.equal(await inspect.getAttribute("data-example-menu-theme"), "#426b42");
      await inspect.click();
      await page.getByRole("dialog", { name: "Content inspection" }).waitFor();
      assert.equal(await page.getByRole("menu").count(), 0);
      assert.equal(
        await page
          .getByRole("button", { name: "Close inspection" })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await page.getByRole("button", { name: "Close inspection" }).click();
      const toolTab = await page.getByRole("tab", { name: "Inspector", exact: true }).boundingBox();
      const reportContent = await page
        .locator('[data-worksplit-role="document"]:visible')
        .boundingBox();
      assert.ok(toolTab && reportContent);
      await page.mouse.move(toolTab.x + toolTab.width / 2, toolTab.y + toolTab.height / 2);
      await page.mouse.down();
      await page.mouse.move(toolTab.x + toolTab.width / 2 + 14, toolTab.y + toolTab.height / 2, {
        steps: 3,
      });
      await page.mouse.move(
        reportContent.x + reportContent.width / 2,
        reportContent.y + reportContent.height / 2,
        { steps: 12 },
      );
      await page.mouse.move(
        reportContent.x + reportContent.width / 2 + 5,
        reportContent.y + reportContent.height / 2 + 5,
      );
      await page.locator(".flexlayout__outline_rect").waitFor({ state: "visible" });
      await page.mouse.up();
      await page.waitForFunction(
        () => window.worksplitPublic.tools.getContent("inspector")?.containerId !== "border_bottom",
      );
      assert.equal(await filter.inputValue(), "Tool local state");
      report.checks.push(
        `${viewport.width}×${viewport.height}: tool controller, shared-provider custom menu, focus return before modal, real border docking preserves tool state`,
      );

      await options.extra?.(page, { viewport, report });
      await page.screenshot({
        path: join(dirname(reportFile), `public-api-${viewport.width}.png`),
      });
      await page.evaluate(() => window.worksplitPublic.dispose());
      assert.equal(await page.locator(".worksplit-workbench").count(), 0);
      assert.equal(
        await page.evaluate(() =>
          [
            window.worksplitPublic.readOnly,
            window.worksplitPublic.editor,
            window.worksplitPublic.tools,
          ].every((instance) => instance.getDocuments().length === 0),
        ),
        true,
      );
      await context.close();
    }
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 900, height: 768 },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Browser acceptance is deliberately serial.
      await checkViewport(viewport);
    }
    assert.deepEqual(report.pageErrors, []);
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = String(error?.stack ?? error);
    report.focus = await currentPage
      ?.evaluate(() => ({
        active: document.activeElement?.outerHTML,
        tabs: [...document.querySelectorAll('[role="tab"]')].map((element) => ({
          id: element.id,
          label: element.textContent,
          selected: element.getAttribute("aria-selected"),
        })),
      }))
      .catch(() => null);
    await currentPage
      ?.screenshot({ path: join(dirname(reportFile), "public-api-failed.png") })
      .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server) await new Promise((done) => server.httpServer.close(done));
    await mkdir(dirname(reportFile), { recursive: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkPublicApiBrowser();
