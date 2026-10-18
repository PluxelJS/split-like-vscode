import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { chromium, expect } from "@playwright/test";

const repository = resolve(import.meta.dirname, "..");
const acceptance = resolve(repository, "test-results/packed-consumer");

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
      compact: { width: 1366, height: 768 },
      narrow: { width: 390, height: 844 },
      keyboard:
        "Control modifier in Linux Chromium; application-owned native Store and HotkeysProvider",
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
    await checkDocumentOperations(page, url, report);
    await checkBoundedWorkspace(page, url, report, report.conditions.desktop, "desktop");
    await checkBoundedWorkspace(page, url, report, report.conditions.compact, "compact");
    await checkPagePlacement(page, url, report, report.conditions.desktop, "desktop");
    await checkPagePlacement(page, url, report, report.conditions.compact, "compact");
    await checkPlacementFocusRace(page, url, report);
    await checkEmptyHome(page, url, report);
    await checkStrictMode(context, consumerDirectory, report);
    await checkFocusedToolPlacement(page, url, report);
    await checkToolActivation(page, url, report);
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

async function checkToolActivation(page, url, report) {
  await page.goto(`${url}/documents/A?view=edit`);
  await page.getByLabel("Draft A", { exact: true }).waitFor();
  const before = await page.evaluate(async () => {
    const { workbench, Actions } = window.packedConsumer;
    const active = workbench.getActiveDocument().id;
    const href = location.href;
    const border = workbench
      .getLayout()
      .borders.find((node) => node.children.some((tab) => tab.id === "inspector"));
    if (!border) throw new Error("Inspector border missing");
    const result = await workbench.dispatch(
      Actions.updateNodeAttributes(`border_${border.location}`, { show: false }),
    );
    if (result.status !== "applied") throw new Error(result.status);
    return { active, href };
  });
  assert.equal(
    await page.evaluate(() => window.packedConsumer.workbench.activate("inspector")),
    true,
  );
  await expect(page.getByLabel("inspector note", { exact: true })).toBeVisible();
  await expect(page.getByLabel("inspector note", { exact: true })).toBeFocused();
  assert.deepEqual(
    await page.evaluate(() => ({
      active: window.packedConsumer.workbench.getActiveDocument().id,
      href: location.href,
    })),
    before,
  );
  report.checks.push(
    "Explicit tool activation reveals and focuses a hidden native Border without changing the active document or URL",
  );
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

  await checkKeyboardPreferences(page, a, b, report);
  assert.ok(
    await sameEditor(editorA, "A"),
    "Keyboard preference rerenders must keep A's editor DOM",
  );
  assert.ok(
    await sameEditor(editorB, "B"),
    "Keyboard preference rerenders must keep B's editor DOM",
  );
  await expect(providerA).toHaveAttribute("data-provider-token", tokenA);
  await expect(providerB).toHaveAttribute("data-provider-token", tokenB);

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

async function checkDocumentOperations(page, url, report) {
  await page.setViewportSize(report.conditions.desktop);
  await page.goto(`${url}/documents/A?view=edit`);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  await page.getByText("Document and layout actions", { exact: true }).click();
  const a = await documentNamed(page, "A");
  const b = await documentNamed(page, "B");
  await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
  await page.getByRole("link", { name: "Preview with native Link", exact: true }).first().click();
  await expect(page).toHaveURL(/\/documents\/A\?view=preview$/);
  await page.getByLabel("Draft A", { exact: true }).fill("Unsaved filters must survive reveal");
  const beforeReveal = await sample(page);
  await page.getByRole("button", { name: "Reveal A preserving filters", exact: true }).click();
  await expect(page.getByLabel("Operation status", { exact: true })).toContainText(
    '"status":"committed"',
  );
  await expect(page).toHaveURL(/\/documents\/A\?view=preview$/);
  await expect(page.getByLabel("Draft A", { exact: true })).toHaveValue(
    "Unsaved filters must survive reveal",
  );
  assert.equal((await sample(page)).metrics.loads, beforeReveal.metrics.loads);
  assert.equal((await sample(page)).metrics.lastLeave, beforeReveal.metrics.lastLeave);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeFocused();
  dismissNext(page, report);
  await page.getByRole("button", { name: "Open A", exact: true }).click();
  await expect(page.getByLabel("Operation status", { exact: true })).toContainText(
    '"status":"rejected"',
  );
  const leave = JSON.parse((await sample(page)).metrics.lastLeave);
  assert.deepEqual(leave, {
    reason: "navigate",
    id: a.id,
    from: "/documents/A?view=preview",
    to: "/documents/A?view=edit",
  });
  await page
    .locator(`article.editor[data-document-id="${a.id}"]`)
    .getByRole("button", { name: "Save document", exact: true })
    .click();
  await expect.poll(async () => (await sample(page)).metrics.lastSavedId).toBe(a.id);
  report.checks.push(
    "Preserving identity reuse retains dirty content, filters, focus and loaders; explicit navigation receives from/to decision context",
  );

  const aGroup = page
    .locator(".flexlayout__tabset")
    .filter({ has: page.locator(`#flexlayout-tabbutton-${a.id}`) });
  await aGroup.getByRole("button", { name: "Maximize tabset", exact: true }).click();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Open B", exact: true }).click();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeFocused();
  assert.equal((await sample(page)).editing.activeTabId, b.id);
  // Explicit activation may transfer maximization or restore; both must reveal its target.
  const restore = page.getByRole("button", { name: "Restore tabset", exact: true });
  if (await restore.count()) await restore.click();
  report.checks.push(
    "Opening an existing document in another maximized group makes its content visible and restores its registered focus",
  );

  await page.getByRole("button", { name: "Preview C", exact: true }).click();
  await expect(page.getByLabel("Draft C", { exact: true })).toBeFocused();
  const c = await documentNamed(page, "C");
  assert.equal(c.preview, true);
  const beforeReplace = await sample(page);
  await page.getByRole("button", { name: "Preview D", exact: true }).click();
  await expect(page.getByLabel("Draft D", { exact: true })).toBeFocused();
  const d = await documentNamed(page, "D");
  assert.notEqual(d.id, c.id, "Preview replacement owns a fresh document and Router identity");
  await expect(page.getByLabel("Draft C", { exact: true })).toHaveCount(0);
  const replaced = await sample(page);
  assert.equal(replaced.documents.length, beforeReplace.documents.length);
  assert.equal(replaced.metrics.disposals, beforeReplace.metrics.disposals + 1);
  assert.equal(replaced.documents.filter((document) => document.preview).length, 1);
  await page.getByRole("button", { name: "Keep active document", exact: true }).click();
  await expect.poll(async () => (await documentNamed(page, "D")).preview).toBe(false);
  const nativeD = (await sample(page)).layout;
  assert.ok(
    !findNativeTab(nativeD, d.id).pinned,
    "Keeping a preview does not native-pin it against closing",
  );
  await page.getByRole("button", { name: "Preview E", exact: true }).click();
  await expect(page.getByLabel("Draft E", { exact: true })).toBeFocused();
  const e = await documentNamed(page, "E");
  await page.getByRole("button", { name: "Preview D", exact: true }).click();
  await expect(page.getByLabel("Draft D", { exact: true })).toBeFocused();
  assert.equal((await documentNamed(page, "E")).id, e.id);
  assert.equal((await documentNamed(page, "E")).preview, true);
  assert.equal((await documentNamed(page, "D")).id, d.id);
  await page.locator(`#flexlayout-tabbutton-${e.id}`).click();
  await page.getByLabel("Draft E", { exact: true }).fill("Dirty preview retained automatically");
  await page.getByRole("button", { name: "Preview F", exact: true }).click();
  await expect(page.getByLabel("Draft F", { exact: true })).toBeFocused();
  const f = await documentNamed(page, "F");
  assert.equal((await documentNamed(page, "E")).preview, false);
  await expect(page.getByLabel("Draft E", { exact: true })).toHaveValue(
    "Dirty preview retained automatically",
  );
  assert.equal(f.preview, true);
  await page.getByRole("button", { name: "Duplicate active document", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await sample(page)).documents.filter((document) => document.href.includes("/documents/F?"))
          .length,
    )
    .toBe(2);
  const copies = (await sample(page)).documents.filter((document) =>
    document.href.includes("/documents/F?"),
  );
  assert.equal(copies.find((document) => document.id !== f.id).preview, false);
  assert.equal(copies.find((document) => document.id === f.id).preview, true);
  report.checks.push(
    "Clean preview replacement disposes once with fresh identity; keep stays closeable; existing targets preserve another preview; dirty preview auto-keeps; copies are ordinary documents",
  );
  await expect(page.getByLabel("Issues", { exact: true })).toHaveText("No issues");
  report.documentOperations = {
    documents: (await sample(page)).documents,
    metrics: (await sample(page)).metrics,
  };
}

async function checkBoundedWorkspace(page, url, report, viewport, label) {
  await page.setViewportSize(viewport);
  await page.goto(`${url}/documents/A?view=edit#bounded`);
  await expect.poll(async () => (await sample(page)).documents.length).toBe(2);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await page.getByText("Document and layout actions", { exact: true }).click();
  const a = await documentNamed(page, "A");
  const b = await documentNamed(page, "B");
  assert.equal(nativeTabsets((await sample(page)).layout).length, 1);
  await page.locator(`#flexlayout-tabbutton-${b.id}`).click();
  await page.getByRole("button", { name: "Split active right", exact: true }).click();
  await expect.poll(async () => nativeTabsets((await sample(page)).layout).length).toBe(2);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
  await page.getByRole("button", { name: "Preview C", exact: true }).click();
  await expect(page.getByLabel("Draft C", { exact: true })).toBeVisible();
  const c = await documentNamed(page, "C");
  await page.getByRole("button", { name: "Keep active document", exact: true }).click();
  // A real mouse gesture splits the left pane; programmatic model calls are not drag acceptance.
  const leftContent = page.locator(`.worksplit-content[data-worksplit-content="${c.id}"]`);
  await mouseDropContent(
    page,
    page.locator(`#flexlayout-tabbutton-${c.id}`),
    leftContent,
    "bottom",
  );
  await expect.poll(async () => nativeTabsets((await sample(page)).layout).length).toBe(3);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft C", { exact: true })).toBeVisible();
  await page.locator(`#flexlayout-tabbutton-${b.id}`).click();
  await page.getByRole("button", { name: "Preview D", exact: true }).click();
  await expect(page.getByLabel("Draft D", { exact: true })).toBeVisible();
  const d = await documentNamed(page, "D");
  await page.getByRole("button", { name: "Keep active document", exact: true }).click();
  await page.getByRole("button", { name: "Split active bottom", exact: true }).click();
  await expect.poll(async () => nativeTabsets((await sample(page)).layout).length).toBe(4);
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  const boxes = await Promise.all(
    [a, b, c, d].map((document) =>
      page.locator(`.worksplit-content[data-worksplit-content="${document.id}"]`).boundingBox(),
    ),
  );
  assert.ok(boxes.every((box) => box && box.width > 200 && box.height > 80));
  assert.ok(boxes[0].x < boxes[1].x && boxes[2].x < boxes[3].x);
  assert.ok(boxes[0].y < boxes[2].y && boxes[1].y < boxes[3].y);
  // Keep an extra tab in its source: releasing an empty source could make this move legal.
  await page.getByRole("button", { name: "Preview E", exact: true }).click();
  await expect(page.getByLabel("Draft E", { exact: true })).toBeVisible();
  const e = await documentNamed(page, "E");
  const beforeRejected = await sample(page);
  await page.getByRole("button", { name: "Split active right", exact: true }).click();
  await expect(page.getByLabel("Operation status", { exact: true })).toHaveText(
    '{"status":"rejected"}',
  );
  assert.deepEqual((await sample(page)).layout, beforeRejected.layout);
  await mouseDropContent(
    page,
    page.locator(`#flexlayout-tabbutton-${e.id}`),
    page.locator(`.worksplit-content[data-worksplit-content="${a.id}"]`),
    "right",
  );
  await settle(page);
  assert.deepEqual(
    (await sample(page)).layout,
    beforeRejected.layout,
    "The actual fifth-group/third-column drag must be rejected before changing native JSON",
  );
  await page.screenshot({ path: resolve(acceptance, `packed-consumer-bounded-${label}.png`) });
  await mouseDropContent(
    page,
    page.locator(`#flexlayout-tabbutton-${e.id}`),
    page.locator(`.worksplit-content[data-worksplit-content="${a.id}"]`),
    "center",
  );
  await expect
    .poll(async () => await currentContainer(page, e.id))
    .toBe(await currentContainer(page, a.id));
  assert.equal(nativeTabsets((await sample(page)).layout).length, 4);
  report.checks.push(
    `${viewport.width}×${viewport.height}: application menu makes two columns; real drag plus menu makes 2×2; program and real over-limit drag reject; center drag still moves tabs`,
  );
  report.screenshots.push(`packed-consumer-bounded-${label}.png`);
  (report.bounded ??= {})[label] = { viewport, boxes, snapshot: (await sample(page)).snapshot };
  await expect(page.getByLabel("Issues", { exact: true })).toHaveText("No issues");
}

async function checkPagePlacement(page, url, report, viewport, label) {
  await page.setViewportSize(viewport);
  await page.goto(`${url}/fixture-page-placement-${label}#bounded`);
  await expect.poll(async () => (await sample(page)).documents.length).toBe(2);
  const a = await documentNamed(page, "A");
  const source = page.locator(`article.editor[data-document-id="${a.id}"]`);
  const input = source.getByLabel("Draft A", { exact: true });
  await input.fill(
    Array.from(
      { length: 100 },
      (_, index) => `Source line ${index}: retained caret and scroll`,
    ).join("\n"),
  );
  await input.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+ArrowUp");
  const inputBefore = await inputState(input);
  assert.ok(inputBefore.scrollTop > 0 && inputBefore.end > inputBefore.start);
  const before = await sample(page);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(source.getByLabel("Detail placement A", { exact: true })).toHaveText("committed");
  await expect(page.getByLabel("Draft A-detail-1", { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
  const inputAfter = await inputState(input);
  assert.deepEqual(
    inputAfter,
    inputBefore,
    "The real input shortcut retains caret, selection, text and inner scroll",
  );
  const shown = await sample(page);
  const right = await documentNamed(page, "A-detail-1");
  assert.equal(shown.editing.activeTabId, a.id);
  assert.equal(shown.href, before.href);
  assert.notEqual(right.containerId, a.containerId);
  assert.equal(right.containerId, await currentContainer(page, right.id));
  assert.equal(nativeTabsets(shown.layout).length, 2);
  await page
    .locator(`article.editor[data-document-id="${right.id}"]`)
    .getByRole("button", { name: "Keep this document", exact: true })
    .click();
  await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
  const sourceGroup = page
    .locator(".flexlayout__tabset")
    .filter({ has: page.locator(`#flexlayout-tabbutton-${a.id}`) });
  await sourceGroup.getByRole("button", { name: "Maximize tabset", exact: true }).click();
  await expect(page.getByLabel("Draft A-detail-1", { exact: true })).toBeHidden();
  const showBelow = source.getByRole("button", { name: "Show detail below", exact: true });
  await showBelow.click();
  await expect(source.getByLabel("Detail placement A", { exact: true })).toHaveText("committed");
  await expect(page.getByLabel("Draft A-detail-2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft A-detail-1", { exact: true })).toBeVisible();
  await expect(input).toBeVisible();
  await expect(showBelow).toBeFocused();
  const fromMaximized = await sample(page);
  assert.equal(fromMaximized.editing.activeTabId, a.id);
  assert.equal(fromMaximized.href, before.href);
  assert.equal(nativeTabsets(fromMaximized.layout).length, 3);
  const lowerLeft = await documentNamed(page, "A-detail-2");
  await page
    .locator(`article.editor[data-document-id="${lowerLeft.id}"]`)
    .getByRole("button", { name: "Keep this document", exact: true })
    .click();
  await page.locator(`#flexlayout-tabbutton-${right.id}`).click();
  const rightSource = page.locator(`article.editor[data-document-id="${right.id}"]`);
  await rightSource.getByRole("button", { name: "Focus detail below", exact: true }).click();
  await expect(page.getByLabel("Draft A-detail-1-detail-1", { exact: true })).toBeFocused();
  const focused = await documentNamed(page, "A-detail-1-detail-1");
  assert.equal((await sample(page)).editing.activeTabId, focused.id);
  assert.equal((await sample(page)).href, focused.href);
  assert.equal(nativeTabsets((await sample(page)).layout).length, 4);
  await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
  const showRight = source.getByRole("button", { name: "Show detail right", exact: true });
  // Capture after the actual source activation; a refused operation must not mutate its topology.
  const atLimit = await sample(page);
  await showRight.click();
  await expect(source.getByLabel("Detail placement A", { exact: true })).toHaveText(
    "rejected:layout-policy",
  );
  await expect(showRight).toBeFocused();
  const denied = await sample(page);
  assert.deepEqual(denied.layout, atLimit.layout);
  assert.deepEqual(denied.documents, atLimit.documents);
  assert.equal(denied.href, atLimit.href);
  assert.equal(denied.editing.activeTabId, a.id);
  await page.screenshot({
    path: resolve(acceptance, `packed-consumer-page-placement-${label}.png`),
  });
  report.screenshots.push(`packed-consumer-page-placement-${label}.png`);
  (report.pagePlacement ??= {})[label] = {
    viewport,
    keyboardSource: {
      before: inputBefore,
      after: inputAfter,
      activeId: shown.editing.activeTabId,
      href: shown.href,
    },
    nativeContainers: [
      a.containerId,
      right.containerId,
      lowerLeft.containerId,
      focused.containerId,
    ],
    rejected: {
      status: await source.getByLabel("Detail placement A", { exact: true }).textContent(),
      documents: denied.documents.length,
    },
    focusContract:
      "Keyboard action preserves textarea focus/caret/selection/scroll; ordinary button clicks preserve the clicked button's focus. No focus-restoration event handlers are supplied by the application.",
  };
  report.checks.push(
    `${viewport.width}×${viewport.height}: in-document public open uses source container plus native DockLocation; keyboard retains input selection/scroll and source URL; maximized button opens visibly without stealing button focus; ordinary beside open focuses target; full 2×2 refuses without changing documents/layout`,
  );

  await page.goto(`${url}/fixture-preview-source-${label}#bounded`);
  await expect.poll(async () => (await sample(page)).documents.length).toBe(2);
  await page.getByText("Document and layout actions", { exact: true }).click();
  await page.getByRole("button", { name: "Preview C", exact: true }).click();
  const cInput = page.getByLabel("Draft C", { exact: true });
  await expect(cInput).toBeFocused();
  const c = await documentNamed(page, "C");
  assert.equal(c.preview, true);
  const previewSource = await sample(page);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(page.getByLabel("Draft C-detail-1", { exact: true })).toBeVisible();
  await expect(cInput).toBeFocused();
  assert.equal((await documentNamed(page, "C")).preview, false);
  assert.equal((await documentNamed(page, "C-detail-1")).preview, true);
  assert.equal((await sample(page)).editing.activeTabId, c.id);
  assert.equal((await sample(page)).href, previewSource.href);
  report.checks.push(
    `${viewport.width}×${viewport.height}: a source preview is kept before preserving-focus detail admission, retaining the original source DOM and browser URL`,
  );
}

async function checkPlacementFocusRace(page, url, report) {
  await page.setViewportSize(report.conditions.desktop);
  await page.goto(`${url}/documents/A?view=edit#bounded`);
  await expect.poll(async () => (await sample(page)).documents.length).toBe(2);
  await page
    .getByRole("group", { name: "Document A actions", exact: true })
    .getByRole("button", { name: "Focus detail right", exact: true })
    .click();
  await expect(page.getByLabel("Draft A-detail-1", { exact: true })).toBeFocused();
  const ordinary = await documentNamed(page, "A-detail-1");
  assert.equal((await sample(page)).editing.activeTabId, ordinary.id);
  assert.equal((await sample(page)).href, ordinary.href);
  report.checks.push(
    "An ordinary in-document right-side open selects the new detail, publishes its URL and focuses its first mounted input",
  );
  await page.goto(`${url}/documents/A?view=edit`);
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  const a = await documentNamed(page, "A");
  const b = await documentNamed(page, "B");
  await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
  await page
    .locator(`article.editor[data-document-id="${a.id}"]`)
    .getByRole("button", { name: "Open delayed detail", exact: true })
    .click();
  await page.locator(`#flexlayout-tabbutton-${b.id}`).click();
  const bInput = page.getByLabel("Draft B", { exact: true });
  await bInput.click();
  const newer = await sample(page);
  await expect(page.getByLabel("Detail placement A", { exact: true })).toHaveText("committed");
  const slow = await documentNamed(page, "Slow-A");
  assert.equal(
    slow.containerId,
    a.containerId,
    "The default placement target is captured at call time",
  );
  await expect(bInput).toBeFocused();
  assert.equal((await sample(page)).editing.activeTabId, b.id);
  assert.equal((await sample(page)).href, newer.href);
  report.checks.push(
    "A page action's delayed load keeps its call-time native destination while a newer real tab/input focus preserves the active document and URL",
  );
  report.placementFocusRace = { source: a, newer: b, committed: slow };
}

async function checkFocusedToolPlacement(page, url, report) {
  await page.goto(`${url}/documents/ToolPlacement?view=edit`);
  await expect.poll(async () => (await sample(page)).documents.length).toBe(2);
  const note = page.getByLabel("inspector note", { exact: true });
  await note.click();
  const before = await sample(page);
  const border = before.layout.borders.find((candidate) =>
    candidate.children.some((tab) => tab.id === "inspector"),
  );
  assert.ok(border?.location, "Focused Inspector has a native Border container");
  // Native Border ids are derived from location; the JSON does not persist a separate id.
  const borderId = "border_" + border.location;
  const request = (target) =>
    page.evaluate(
      (container) =>
        window.packedConsumer.workbench.open(
          { to: "/documents/$id", params: { id: "ToolDetail" }, search: { view: "edit" } },
          { target: container, preserveFocus: true },
        ),
      target,
    );
  assert.deepEqual(await request(borderId), { status: "rejected", reason: "focus-conflict" });
  await expect(note).toBeFocused();
  assert.deepEqual((await sample(page)).layout, before.layout);
  assert.deepEqual((await sample(page)).documents, before.documents);
  const source = before.documents.find((doc) => doc.id === before.editing.activeTabId);
  const other = before.documents.find((doc) => doc.containerId !== source.containerId);
  assert.ok(other, "Fixture has another selected central pane");
  assert.equal((await request(other.containerId)).status, "committed");
  await expect(note).toBeFocused();
  await expect(page.getByLabel("Draft ToolDetail", { exact: true })).toBeVisible();
  const after = await sample(page);
  assert.equal(after.editing.activeTabId, source.id);
  assert.equal(after.href, before.href);
  report.checks.push(
    "A genuinely focused tool cannot be hidden by preserve-focus CENTER admission; a separate pane reveals the detail while retaining the tool input, active document and URL",
  );
}

function inputState(input) {
  return input.evaluate((node) => ({
    text: node.value,
    start: node.selectionStart,
    end: node.selectionEnd,
    scrollTop: node.scrollTop,
  }));
}

async function checkEmptyHome(page, url, report) {
  await page.goto(`${url}/#empty-home`);
  await expect(page.getByLabel("Startup status", { exact: true })).toHaveText("empty");
  const empty = await sample(page);
  assert.equal(empty.documents.length, 0);
  assert.equal(empty.editing.activeTabId, null);
  assert.equal(empty.metrics.loads, 0);
  assert.equal(
    empty.metrics.routersCreated,
    1,
    "Empty home creates only the instance resolver, no document Router",
  );
  await expect(
    page.getByText("Application native empty group", { exact: true }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(`${url}/#empty-home`);
  await page.getByRole("button", { name: "Open A", exact: true }).click();
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  const a = await documentNamed(page, "A");
  await page.locator(`#flexlayout-tabbutton-${a.id} [title=Close]`).click();
  await expect.poll(async () => (await sample(page)).documents.length).toBe(0);
  await expect(page).toHaveURL(`${url}/#empty-home`);
  const afterClose = await sample(page);
  await page.goBack();
  await settle(page);
  await expect(page).toHaveURL(`${url}/#empty-home`);
  assert.equal((await sample(page)).documents.length, 0);
  assert.equal((await sample(page)).metrics.routersCreated, afterClose.metrics.routersCreated);
  await page.goForward();
  await settle(page);
  assert.equal((await sample(page)).documents.length, 0);
  assert.equal((await sample(page)).metrics.loads, afterClose.metrics.loads);
  await page.reload();
  await expect(page.getByLabel("Startup status", { exact: true })).toHaveText("empty");
  assert.equal((await sample(page)).documents.length, 0);
  report.checks.push(
    "Empty home start, last close, real browser Back/Forward between empty anchors and reload keep zero documents without document Routers or loaders",
  );

  await page.goto(`${url}/fixture-owned-home#empty-home`);
  await expect(page.getByLabel("Startup status", { exact: true })).toHaveText("empty");
  await page.getByRole("button", { name: "Open A", exact: true }).click();
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  const retained = await documentNamed(page, "A");
  const beforeHome = await sample(page);
  await page.goBack();
  await expect(page).toHaveURL(`${url}${retained.href}`);
  await settle(page);
  assert.equal((await sample(page)).documents.length, 1);
  assert.equal((await sample(page)).editing.activeTabId, retained.id);
  assert.equal((await sample(page)).metrics.loads, beforeHome.metrics.loads);
  assert.equal((await sample(page)).metrics.lifecycleDisposals, 0);
  await page.goForward();
  await expect(page).toHaveURL(`${url}${retained.href}`);
  assert.equal((await sample(page)).documents.length, 1);
  await page.getByRole("button", { name: "Open B", exact: true }).click();
  await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
  const b = await documentNamed(page, "B");
  await page.locator(`#flexlayout-tabbutton-${retained.id}`).click();
  await page.getByRole("button", { name: "Save reload snapshot", exact: true }).click();
  const beforeReload = await sample(page);
  await page.goto(`${url}/#empty-home`);
  await expect(page.getByLabel("Startup status", { exact: true })).toHaveText("committed");
  await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${url}${retained.href}`);
  const restored = await sample(page);
  assert.deepEqual(
    restored.documents.map((document) => document.id).toSorted(),
    [retained.id, b.id].toSorted(),
  );
  assert.equal(restored.editing.activeTabId, retained.id);
  assert.equal(restored.metrics.loads, 1, "Restoring selected A from home leaves hidden B lazy");
  assert.equal(restored.metrics.lifecycleDisposals, 0);
  await expect(page.getByLabel("Draft B", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Issues", { exact: true })).toHaveText("No issues");
  await page.screenshot({ path: resolve(acceptance, "packed-consumer-empty-home-restored.png") });
  report.screenshots.push("packed-consumer-empty-home-restored.png");
  report.emptyHome = { empty, beforeHome, beforeReload: beforeReload.snapshot, restored };
  report.checks.push(
    "Back to an owned home anchor retains live documents and normalizes its URL; snapshot plus home restores native selected A while hidden B remains lazy",
  );
  await page.evaluate(() => sessionStorage.removeItem("packed-empty-home-snapshot"));
}

async function checkStrictMode(context, directory, report) {
  // React's production build deliberately omits effect replay. Use the same installed public
  // tarballs with Vite development serving to test real StrictMode setup/cleanup/setup.
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const development = startPreview(directory, port, true);
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  try {
    await waitForPreview(development, url);
    await page.goto(`${url}/documents/A?view=edit#strict`);
    await expect(page.getByLabel("Draft A", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Draft B", { exact: true })).toBeVisible();
    await settle(page);
    const initial = await sample(page);
    assert.ok(
      initial.metrics.editorMounts >= 4,
      "Two real document effects must have replayed under development StrictMode",
    );
    assert.ok(
      initial.metrics.editorUnmounts >= 2,
      "The fixture must observe rehearsal effect cleanups",
    );
    assert.equal(initial.metrics.subscriptions, 2);
    assert.equal(initial.metrics.providers, 2);
    assert.equal(
      initial.metrics.lifecycleDisposals,
      0,
      "Effect rehearsal must not dispose Worksplit content resources",
    );
    const a = await documentNamed(page, "A");
    const b = await documentNamed(page, "B");
    await page.getByLabel("Draft A", { exact: true }).fill("StrictMode still guards this draft");
    dismissNext(page, report);
    await page.locator(`#flexlayout-tabbutton-${a.id} [title=Close]`).click();
    await settle(page);
    await expect(page.getByLabel("Draft A", { exact: true })).toHaveValue(
      "StrictMode still guards this draft",
    );
    assert.equal((await sample(page)).metrics.lifecycleDisposals, 0);
    await page.locator(`#flexlayout-tabbutton-${b.id}`).click();
    await page.locator(`#flexlayout-tabbutton-${a.id}`).click();
    assert.equal((await sample(page)).metrics.lifecycleDisposals, 0);
    acceptNext(page, report);
    await page.locator(`#flexlayout-tabbutton-${a.id} [title=Close]`).click();
    await expect(page.getByLabel("Draft A", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await sample(page)).metrics.lifecycleDisposals).toBe(1);
    assert.equal((await sample(page)).metrics.subscriptions, 1);
    const closed = await sample(page);
    assert.equal(closed.documents[0].id, b.id);
    await expect(page.getByLabel("Issues", { exact: true })).toHaveText("No issues");
    await page.screenshot({ path: resolve(acceptance, "packed-consumer-strict-mode.png") });
    report.screenshots.push("packed-consumer-strict-mode.png");
    assert.deepEqual(await page.evaluate(() => window.packedConsumer.workbench.dispose()), []);
    await expect.poll(async () => (await sample(page)).metrics.lifecycleDisposals).toBe(2);
    assert.deepEqual(await page.evaluate(() => window.packedConsumer.workbench.dispose()), []);
    assert.equal((await sample(page)).metrics.lifecycleDisposals, 2);
    assert.equal((await sample(page)).metrics.subscriptions, 0);
    report.strictMode = {
      development: true,
      distribution:
        "Freshly installed public tarballs; Vite dev server and development React for actual effect replay",
      initial,
      closed,
      disposed: await sample(page),
    };
    report.checks.push(
      "Real development StrictMode effect replay leaves lifecycle resources live and dirty guards installed; genuine close disposes once, host disposal once, repeat disposal never again",
    );
  } finally {
    await page.close();
    await stopPreview(development);
    report.strictModeServer = { exit: development.exit, log: development.log };
  }
}

async function documentNamed(page, name) {
  const document = (await sample(page)).documents.find((candidate) =>
    candidate.href.startsWith(`/documents/${name}?`),
  );
  assert.ok(document, "Missing document " + name);
  return document;
}

function collectTabsets(node) {
  return node.type === "tabset" ? [node] : (node.children ?? []).flatMap(collectTabsets);
}

function nativeTabsets(layout) {
  return collectTabsets(layout.layout);
}

function findNativeTab(layout, id) {
  const visit = (node) => (node.id === id ? node : (node.children ?? []).map(visit).find(Boolean));
  return visit(layout.layout);
}

async function mouseDropContent(page, source, target, side) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  assert.ok(from && to, "Both drag endpoints must be real visible rectangles");
  const x = side === "right" ? to.x + to.width - 10 : to.x + to.width / 2;
  const y = side === "bottom" ? to.y + to.height - 10 : to.y + to.height / 2;
  await page.mouse.move(from.x + Math.min(from.width / 2, 60), from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.min(from.width / 2, 60) + 20, from.y + from.height / 2, {
    steps: 5,
  });
  await page.mouse.move(x, y, { steps: 15 });
  await settle(page);
  await page.mouse.up();
}

async function checkKeyboardPreferences(page, a, b, report) {
  const binding = page.getByLabel("Save shortcut", { exact: true });
  const enabled = page.getByLabel("Enable save shortcut", { exact: true });
  const ignoreInputs = page.getByLabel("Ignore shortcuts in inputs", { exact: true });
  const preferences = page.getByLabel("Shortcut preference", { exact: true });
  const receipt = page.getByLabel("Save command receipt", { exact: true });
  const before = await sample(page);
  const saves = before.metrics.saves;
  await expect(preferences).toHaveText("Mod+S · enabled · inputs allowed");
  await expect(binding).toHaveValue("Mod+S");
  await expect(enabled).toBeChecked();
  await expect(ignoreInputs).not.toBeChecked();

  await page.locator(`#flexlayout-tabbutton-${a}`).click();
  await page.getByLabel("Draft A", { exact: true }).focus();
  const first = await pressSaveShortcut(page, "Control+s");
  assert.equal(first.defaultPrevented, true, "The host Provider must prevent the native default");
  await expect(receipt).toHaveText("Saving " + a);
  await page.locator(`#flexlayout-tabbutton-${b}`).click();
  const during = await sample(page);
  assert.equal(during.editing.activeTabId, b);
  assert.equal(during.metrics.pendingSaveId, a, "Native selection must change during A's save");
  await expect(receipt).toHaveText("Saved " + a);
  await settle(page);
  assert.equal((await sample(page)).metrics.saves, saves + 1, "One keypress must save once");
  assert.equal((await sample(page)).editing.activeTabId, b);

  await page.getByLabel("Draft B", { exact: true }).focus();
  const second = await pressSaveShortcut(page, "Control+s");
  assert.equal(second.defaultPrevented, true);
  await expect(receipt).toHaveText("Saved " + b);
  await expect.poll(async () => (await sample(page)).metrics.saves).toBe(saves + 2);
  await settle(page);
  assert.equal((await sample(page)).metrics.saves, saves + 2);
  report.checks.push(
    "Real keyboard save captures A before native selection changes to B; the next shortcut saves B once",
  );

  await binding.selectOption("Mod+Shift+S");
  await expect(preferences).toHaveText("Mod+Shift+S · enabled · inputs allowed");
  await page.getByLabel("Draft B", { exact: true }).focus();
  const oldBinding = await pressSaveShortcut(page, "Control+s");
  assert.equal(oldBinding.defaultPrevented, false, "The old native binding must be unregistered");
  const afterOldBinding = await sample(page);
  assert.equal(afterOldBinding.metrics.pendingSaveId, "");
  assert.equal(afterOldBinding.metrics.saves, saves + 2);
  const rebound = await pressSaveShortcut(page, "Control+Shift+s");
  assert.equal(rebound.defaultPrevented, true);
  await expect(receipt).toHaveText("Saved " + b);
  await expect.poll(async () => (await sample(page)).metrics.saves).toBe(saves + 3);
  await settle(page);
  assert.equal((await sample(page)).metrics.saves, saves + 3);

  await enabled.uncheck();
  await expect(preferences).toHaveText("Mod+Shift+S · disabled · inputs allowed");
  await page.getByLabel("Draft B", { exact: true }).focus();
  const disabled = await pressSaveShortcut(page, "Control+Shift+s");
  assert.equal(disabled.defaultPrevented, false);
  const afterDisabled = await sample(page);
  assert.equal(afterDisabled.metrics.pendingSaveId, "");
  assert.equal(afterDisabled.metrics.saves, saves + 3);
  report.checks.push(
    "Application Store preference UI rebinds and disables the native hook without retaining the old binding or duplicating saves",
  );

  await enabled.check();
  await ignoreInputs.check();
  await expect(preferences).toHaveText("Mod+Shift+S · enabled · inputs ignored");
  await page.getByLabel("Draft B", { exact: true }).focus();
  const ignoredInput = await pressSaveShortcut(page, "Control+Shift+s");
  assert.equal(ignoredInput.defaultPrevented, false);
  const afterInput = await sample(page);
  assert.equal(afterInput.metrics.pendingSaveId, "");
  assert.equal(afterInput.metrics.saves, saves + 3);
  await page.getByRole("button", { name: "Redraw native Layout", exact: true }).focus();
  const outsideInput = await pressSaveShortcut(page, "Control+Shift+s");
  assert.equal(outsideInput.defaultPrevented, true);
  await expect(receipt).toHaveText("Saved " + b);
  await expect.poll(async () => (await sample(page)).metrics.saves).toBe(saves + 4);
  await settle(page);
  assert.equal((await sample(page)).metrics.saves, saves + 4);
  await ignoreInputs.uncheck();
  await binding.selectOption("Mod+S");
  await expect(preferences).toHaveText("Mod+S · enabled · inputs allowed");
  const after = await sample(page);
  assert.deepEqual(after.documents, before.documents);
  assert.deepEqual(lifetimes(after.metrics), lifetimes(before.metrics));
  assert.equal(after.metrics.loads, before.metrics.loads);
  report.checks.push(
    "Native Provider preventDefault and input options govern real keyboard events; app Store updates keep document providers and resources",
  );
  report.externalKeyboard = {
    before: before.metrics,
    whileSavePending: {
      activeDocumentId: during.editing.activeTabId,
      pendingSaveId: during.metrics.pendingSaveId,
    },
    after: after.metrics,
    events: { first, second, oldBinding, rebound, disabled, ignoredInput, outsideInput },
  };
}

function pressSaveShortcut(page, binding) {
  const observed = page.evaluate(
    () =>
      new Promise((done, failed) => {
        const observe = (event) => {
          if (event.code !== "KeyS") return;
          document.removeEventListener("keydown", observe);
          clearTimeout(deadline);
          queueMicrotask(() =>
            done({ code: event.code, defaultPrevented: event.defaultPrevented }),
          );
        };
        const deadline = setTimeout(() => {
          document.removeEventListener("keydown", observe);
          failed(new Error("The real save keypress did not reach the document"));
        }, 10000);
        document.addEventListener("keydown", observe);
      }),
  );
  return Promise.all([observed, page.keyboard.press(binding)]).then(([event]) => event);
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

function startPreview(directory, port, development = false) {
  const child = spawn(
    process.execPath,
    [
      resolve(directory, "node_modules/vite/bin/vite.js"),
      ...(development ? [] : ["preview"]),
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
