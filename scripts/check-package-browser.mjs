import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const repository = resolve(import.meta.dirname, "..");
const acceptance = resolve(repository, "refactor/acceptance");

/** Drive the built app installed from Worksplit tarballs, using the real public consumer fixture. */
export async function checkPackageBrowser(consumerDirectory) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const preview = startPreview(consumerDirectory, port);
  let browser;
  const report = {
    startedAt: new Date().toISOString(),
    status: "running",
    consumerDirectory,
    url,
    conditions: {
      distribution: "Packed public JS, declarations and CSS; Vite production build and preview",
      browser: "Headless Chromium installed by this repository's Playwright",
      desktop: { width: 1440, height: 900 },
      narrow: { width: 390, height: 844 },
      limitations: [
        "One independent tarball consumer fixture; this does not prove Pluxel compatibility or cross-application generality.",
        "Application counters and DOM/provider identity describe this fixture's resources, not heap leak detection or performance.",
        "This application explicitly retains its named native empty TabSets with enableDeleteWhenEmpty:false.",
        "The small window uses unchanged native docking behavior; touch or phone usability is not asserted.",
      ],
    },
    checks: [],
    dialogs: [],
    pageErrors: [],
    consoleErrors: [],
  };
  try {
    await mkdir(acceptance, { recursive: true });
    await waitForPreview(preview, url);
    browser = await chromium.launch({ headless: true });
    report.chromiumVersion = browser.version();
    const context = await browser.newContext({ viewport: report.conditions.desktop });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(message.text());
    });
    await checkConsumer(page, url, report);
    assert.equal(preview.exit, null, "The packed consumer preview exited during acceptance");
    assert.deepEqual(report.pageErrors, [], "The packed consumer raised an unhandled page error");
    assert.deepEqual(report.consoleErrors, [], "The packed consumer logged a console error");
    report.status = "passed";
    return report;
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await stopPreview(preview);
      report.completedAt = new Date().toISOString();
      report.preview = { exit: preview.exit, log: preview.log };
      await writeFile(
        resolve(acceptance, "packed-consumer-results.json"),
        JSON.stringify(report, null, 2) + "\n",
      );
    }
  }
}

async function checkConsumer(page, url, report) {
  await page.goto(`${url}/documents/A?view=edit`);
  await page.getByLabel("Draft A", { exact: true }).waitFor();
  await page.getByLabel("Draft B", { exact: true }).waitFor();
  await expect(page.getByLabel("Native Layout ref", { exact: true })).toHaveText(
    "Native Layout API ready",
  );
  const workspace = page.getByLabel("Published consumer workspace", { exact: true });
  await expect(workspace).toHaveAttribute("data-consumer", "tarball");
  await expect(workspace).toHaveClass(/packed-workspace/);
  await expect(page.getByRole("heading", { name: "Published Worksplit consumer" })).toBeVisible();
  await expect(page.locator(".consumer-icon").first()).toBeVisible();
  await expect(page.locator(".consumer-header").first()).toBeVisible();
  await expect(workspace).toHaveCSS("background-color", "rgb(18, 28, 36)");
  report.checks.push("Custom shell, root HTML props/style/theme, and visible native render slots");

  const initial = await sample(page);
  assert.equal(initial.documents.length, 2, "Two published document sessions must be open");
  const a = initial.documents.find((document) => document.href.includes("/documents/A?"))?.id;
  const b = initial.documents.find((document) => document.href.includes("/documents/B?"))?.id;
  assert.ok(a && b, "The published consumer must expose A and B through the public instance");
  assert.equal(initial.metrics.loads, 2, "Both real document loaders must run");
  assert.equal(
    initial.metrics.routersCreated,
    3,
    "The resolver and two document Routers must exist",
  );
  assert.equal(
    initial.metrics.subscriptions,
    2,
    "Both application resource subscriptions must exist",
  );
  assert.equal(initial.metrics.providerMounts, 2, "Both Router providers must mount");
  await expect(page.locator("[data-router-wrap]")).toHaveCount(2);
  const providerA = page.locator(`[data-router-wrap][data-document-id="${a}"]`);
  const providerB = page.locator(`[data-router-wrap][data-document-id="${b}"]`);
  const tokenA = await providerA.getAttribute("data-provider-token");
  const tokenB = await providerB.getAttribute("data-provider-token");
  assert.ok(
    tokenA && tokenB && tokenA !== tokenB,
    "Each document must have its own Router provider",
  );
  const editorA = await page.getByLabel("Draft A", { exact: true }).elementHandle();
  const editorB = await page.getByLabel("Draft B", { exact: true }).elementHandle();
  assert.ok(editorA && editorB, "Both editor DOM nodes must exist");
  await expect(providerA).toHaveText("External services via Router.Wrap");
  await expect(providerB).toHaveText("External services via Router.Wrap");
  report.initial = { documents: initial.documents, metrics: initial.metrics };
  report.checks.push(
    "Two concurrent public document Routers, application providers and subscriptions",
  );

  await page.getByRole("button", { name: "Rename native tab", exact: true }).click();
  const rename = page.getByRole("textbox", { name: "Rename tab", exact: true });
  await rename.fill("Published consumer notes");
  await rename.press("Enter");
  await expect
    .poll(async () => (await sample(page)).documents.find((doc) => doc.id === a)?.title)
    .toBe("Published consumer notes");
  await page.getByRole("button", { name: "Redraw native Layout", exact: true }).click();
  await settle(page);
  assert.deepEqual(lifetimes((await sample(page)).metrics), lifetimes(initial.metrics));
  assert.ok(await sameEditor(editorA, "A"), "Direct native redraw must keep the editor DOM");
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  report.checks.push(
    "Direct upstream Layout ref inline rename and redraw preserve the provider and editor",
  );

  const saves = (await sample(page)).metrics.saves;
  await page
    .locator(`article.editor[data-document-id="${b}"]`)
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect(page.getByLabel("Save receipt A", { exact: true })).toHaveText(String(saves + 1));
  await expect(page.getByLabel("Save receipt B", { exact: true })).toHaveText(String(saves + 1));
  assert.deepEqual(lifetimes((await sample(page)).metrics), lifetimes(initial.metrics));
  report.checks.push(
    "Both live application subscriptions receive real save receipts after host rerender",
  );

  await page.getByLabel("Draft A", { exact: true }).fill("Draft retained through native movement");
  const beforeMove = await sample(page);
  const source = await currentContainer(page, a);
  const destination = await currentContainer(page, b);
  assert.deepEqual(await move(page, a, destination, "CENTER"), { status: "applied" });
  await settle(page);
  assert.ok(await sameEditor(editorA, "A"), "Native CENTER movement must keep the A editor DOM");
  assert.ok(
    await sameEditor(editorB, "B"),
    "Native CENTER movement must keep the sibling editor DOM",
  );
  await expect(page.getByLabel("Draft A", { exact: true })).toHaveValue(
    "Draft retained through native movement",
  );
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  await expect(providerB).toHaveAttribute("data-provider-token", tokenB);
  assert.deepEqual(lifetimes((await sample(page)).metrics), lifetimes(beforeMove.metrics));
  assert.equal((await sample(page)).metrics.loads, beforeMove.metrics.loads);
  assert.deepEqual(await move(page, a, source, "CENTER"), {
    status: "applied",
  });
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  await settle(page);
  assert.deepEqual(lifetimes((await sample(page)).metrics), lifetimes(beforeMove.metrics));
  report.checks.push(
    "Native movement between application-configured TabSets retains uncontrolled input DOM, providers and resources without loaders",
  );
  await page.screenshot({ path: resolve(acceptance, "packed-consumer-desktop.png") });

  const beforeNavigation = await sample(page);
  const previewLink = page
    .locator(`article.editor[data-document-id="${a}"]`)
    .getByRole("link", { name: "Preview with native Link", exact: true });
  dismissNext(page, report);
  await previewLink.click();
  await settle(page);
  assert.equal(page.url(), `${url}${beforeNavigation.href}`);
  assert.deepEqual((await sample(page)).documents, beforeNavigation.documents);
  assert.equal((await sample(page)).metrics.loads, beforeNavigation.metrics.loads);
  assert.ok(await sameEditor(editorA, "A"), "Rejected native navigation must preserve input DOM");
  dismissNext(page, report);
  await page
    .locator(`article.editor[data-document-id="${a}"]`)
    .getByRole("button", { name: "Preview through workbench", exact: true })
    .click();
  await expect(page.getByLabel("Document navigation A", { exact: true })).toHaveText("rejected");
  assert.equal((await sample(page)).href, beforeNavigation.href);
  assert.deepEqual((await sample(page)).documents, beforeNavigation.documents);
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  report.rejectedWorkbenchNavigation = { metrics: (await sample(page)).metrics };
  acceptNext(page, report);
  await previewLink.click();
  await expect(page).toHaveURL(/\/documents\/A\?view=preview$/);
  await settle(page);
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  assert.ok(await sameEditor(editorB, "B"), "Approved A navigation must preserve its sibling DOM");
  report.checks.push(
    "Typed Workbench open refusal and real TanStack Link dirty navigation refusal/approval coordinate the document URL",
  );

  const beforeTool = await sample(page);
  await page.getByRole("button", { name: "Add registered Outline tool", exact: true }).click();
  await expect(page.getByLabel("outline note", { exact: true })).toBeVisible();
  assert.equal((await sample(page)).href, beforeTool.href);
  await page.locator("#flexlayout-tabbutton-outline [title=Close]").click();
  await expect(page.getByLabel("outline note", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add registered Outline tool", exact: true }).click();
  await expect(page.getByLabel("outline note", { exact: true })).toBeVisible();
  const afterTool = await sample(page);
  assert.equal(afterTool.href, beforeTool.href);
  assert.equal(afterTool.editing.activeTabId, beforeTool.editing.activeTabId);
  assert.equal(afterTool.metrics.loads, beforeTool.metrics.loads);
  assert.deepEqual(lifetimes(afterTool.metrics), lifetimes(beforeTool.metrics));
  report.checks.push(
    "Registered native tool insertion, close and reopen keep the document URL and sessions",
  );

  await page.locator(`#flexlayout-tabbutton-${a}`).click();
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  const beforeResize = await sample(page);
  await page.setViewportSize(report.conditions.narrow);
  await settle(page);
  const resized = await sample(page);
  assert.deepEqual(resized.layout, beforeResize.layout);
  assert.deepEqual(resized.snapshot, beforeResize.snapshot);
  assert.equal(resized.editing.activeTabId, beforeResize.editing.activeTabId);
  assert.deepEqual(lifetimes(resized.metrics), lifetimes(beforeResize.metrics));
  await expect(page.getByRole("combobox", { name: "Open document", exact: true })).toHaveCount(0);
  const tabsetA = page
    .locator(".flexlayout__tabset")
    .filter({ has: page.locator(`#flexlayout-tabbutton-${a}`) });
  await tabsetA.getByRole("button", { name: "Maximize tabset", exact: true }).click();
  await settle(page);
  await expect(page.getByLabel("Draft B", { exact: true })).toBeHidden();
  const manuallyMaximized = await sample(page);
  assert.notDeepEqual(manuallyMaximized.layout, resized.layout);
  assert.ok(await sameEditor(editorA, "A"), "Manual native maximize must preserve editor DOM");
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  await page.screenshot({ path: resolve(acceptance, "packed-consumer-narrow.png") });
  await page.setViewportSize(report.conditions.desktop);
  await settle(page);
  assert.deepEqual((await sample(page)).snapshot, manuallyMaximized.snapshot);
  await page.getByRole("button", { name: "Restore tabset", exact: true }).click();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  assert.ok(await sameEditor(editorB, "B"), "Native Restore must reveal the same sibling DOM");
  assert.deepEqual(lifetimes((await sample(page)).metrics), lifetimes(beforeResize.metrics));
  report.checks.push(
    "Narrow resize keeps native JSON/context/resources; manual maximize persists across widening and restores original DOM",
  );
  report.nativeSnapshots = {
    beforeResize: beforeResize.snapshot,
    manuallyMaximized: manuallyMaximized.snapshot,
  };

  dismissNext(page, report);
  await page.locator(`#flexlayout-tabbutton-${a} [title=Close]`).click();
  await settle(page);
  assert.ok(
    (await sample(page)).documents.some((doc) => doc.id === a),
    "Rejected close must keep A",
  );
  assert.ok(await sameEditor(editorA, "A"), "Rejected native close must keep the editor DOM");
  const beforeClose = await sample(page);
  acceptNext(page, report);
  await page.locator(`#flexlayout-tabbutton-${a} [title=Close]`).click();
  await expect(page.getByLabel("Draft A", { exact: true })).toHaveCount(0);
  await settle(page);
  const closed = await sample(page);
  assert.equal(closed.documents.length, 1);
  assert.equal(closed.documents[0].id, b);
  assert.equal(closed.metrics.subscriptions, beforeClose.metrics.subscriptions - 1);
  assert.equal(closed.metrics.disposals, beforeClose.metrics.disposals + 1);
  assert.equal(closed.metrics.editorUnmounts, beforeClose.metrics.editorUnmounts + 1);
  assert.equal(closed.metrics.providerUnmounts, beforeClose.metrics.providerUnmounts + 1);
  assert.ok(await sameEditor(editorB, "B"), "Closing A must preserve B's editor DOM");
  await expect(providerB).toHaveAttribute("data-provider-token", tokenB);
  await expect(page.getByLabel("Issues", { exact: true })).toHaveText("No issues");
  report.checks.push(
    "Actual native dirty close refusal and approval preserve the sibling and release A's resources once",
  );
  report.beforeDispose = { documents: closed.documents, metrics: closed.metrics };
  const cleanup = await page.evaluate(() => window.packedConsumer.workbench.dispose());
  assert.deepEqual(cleanup, []);
  await settle(page);
  const disposed = await sample(page);
  report.disposed = {
    documentCount: disposed.documents.length,
    metrics: disposed.metrics,
    cleanup,
  };
  assert.equal(disposed.metrics.subscriptions, 0);
  assert.equal(disposed.metrics.liveRouters, 0);
  report.checks.push(
    "Public instance disposal releases the fixture's remaining Routers and subscriptions",
  );
  report.screenshots = ["packed-consumer-desktop.png", "packed-consumer-narrow.png"];
}

function sample(page) {
  return page.evaluate(() => {
    const { workbench, getMetrics } = window.packedConsumer;
    return {
      documents: workbench.getDocuments(),
      editing: workbench.getEditingContext(),
      layout: workbench.getLayout(),
      snapshot: workbench.snapshot(),
      metrics: getMetrics(),
      href: location.pathname + location.search,
    };
  });
}

function lifetimes(metrics) {
  const {
    routersCreated,
    liveRouters,
    editorMounts,
    editorUnmounts,
    subscriptions,
    disposals,
    providerMounts,
    providerUnmounts,
    providers,
  } = metrics;
  return {
    routersCreated,
    liveRouters,
    editorMounts,
    editorUnmounts,
    subscriptions,
    disposals,
    providerMounts,
    providerUnmounts,
    providers,
  };
}

function currentContainer(page, id) {
  return page.evaluate((tabId) => {
    const find = (node) => {
      if (node.type === "tabset" && (node.children ?? []).some((child) => child.id === tabId))
        return node.id;
      return (node.children ?? []).map(find).find(Boolean);
    };
    const target = find(window.packedConsumer.workbench.getLayout().layout);
    if (!target) throw new Error("Missing current native container for " + tabId);
    return target;
  }, id);
}

function move(page, id, target, location) {
  return page.evaluate(
    ({ tabId, to, where }) => {
      const { workbench, Actions, DockLocation } = window.packedConsumer;
      return workbench.dispatch(Actions.moveNode(tabId, to, DockLocation[where], -1));
    },
    { tabId: id, to: target, where: location },
  );
}

function sameEditor(handle, label) {
  return handle.evaluate(
    (node, id) => node === document.querySelector(`[aria-label="Draft ${id}"]`),
    label,
  );
}

function settle(page) {
  return page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

function dismissNext(page, report) {
  page.once("dialog", async (dialog) => {
    report.dialogs.push({ message: dialog.message(), accepted: false });
    await dialog.dismiss();
  });
}

function acceptNext(page, report) {
  page.once("dialog", async (dialog) => {
    report.dialogs.push({ message: dialog.message(), accepted: true });
    await dialog.accept();
  });
}

async function freePort() {
  const server = createServer();
  try {
    await new Promise((ready, failed) => {
      server.once("error", failed);
      server.listen(0, "127.0.0.1", ready);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object", "No local preview port was assigned");
    return address.port;
  } finally {
    await new Promise((closed, failed) => {
      server.close((error) => (error ? failed(error) : closed()));
    });
  }
}

function startPreview(directory, port) {
  const child = spawn(
    process.execPath,
    [
      resolve(directory, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: directory, stdio: ["ignore", "pipe", "pipe"] },
  );
  const preview = { child, log: "", exit: null, failure: null, closed: null };
  const append = (chunk) => {
    preview.log = (preview.log + String(chunk)).slice(-16000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    preview.failure = error;
  });
  preview.closed = new Promise((closed) => {
    child.once("close", (code, signal) => {
      preview.exit = { code, signal };
      closed();
    });
  });
  return preview;
}

async function waitForPreview(preview, url) {
  const expires = Date.now() + 15000;
  /* eslint-disable no-await-in-loop -- Poll the one supervised preview until HTTP is ready. */
  for (;;) {
    if (preview.failure) throw preview.failure;
    if (preview.exit) throw new Error("Packed preview exited: " + preview.log);
    if (Date.now() >= expires)
      throw new Error("Packed preview did not become ready: " + preview.log);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // A refused connection is expected until the supervised Vite process begins listening.
    }
    await delay(100);
  }
  /* eslint-enable no-await-in-loop */
}

async function stopPreview(preview) {
  if (preview.exit) return;
  preview.child.kill("SIGTERM");
  let deadline;
  await Promise.race([
    preview.closed,
    new Promise((done) => {
      deadline = setTimeout(done, 3000);
    }),
  ]);
  clearTimeout(deadline);
  if (!preview.exit) {
    preview.child.kill("SIGKILL");
    await preview.closed;
  }
}

function delay(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}
